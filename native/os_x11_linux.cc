#include <unistd.h>
#include <memory>
#include <iostream>
#include <napi.h>
#include <xcb/composite.h>
#include <xcb/record.h>
#include <xcb/shape.h>
#include <xcb/xcb_icccm.h>
#include <stdint.h>
#include <algorithm>
#include <thread>
#include <mutex>
#include <atomic>
#include <condition_variable>
#include <fstream>
#include <future>
#include <sstream>

#include "os.h"
#include "linux/x11.h"
#include "linux/shm.h"
#include "util.h"

using namespace priv_os_x11;

static constexpr auto rsName = "RuneScape";
static constexpr auto protonName = "steam_proton";

static constexpr std::array<std::string_view, 4> rsClassNames = {
	rsName,
	"steam_app_1343400",
	"rs2client.exe",
	protonName,
};

struct TrackedEvent {
	xcb_window_t window;
	WindowEventType type;
	Napi::ThreadSafeFunction callback;
	Napi::FunctionReference callbackRef;
	TrackedEvent(xcb_window_t window, WindowEventType type, Napi::Function callback)
		: window(window), type(type), callback(Napi::ThreadSafeFunction::New(callback.Env(),
						      callback, "event", 0, 1, [](Napi::Env) {})),
		  callbackRef(Napi::Persistent(callback))
	{
	}
};

struct WindowState {
	int16_t x, y;
	uint16_t w, h;
};
std::map<xcb_window_t, WindowState> windowCache;

std::thread windowThread;
std::thread recordThread;
std::vector<TrackedEvent> trackedEvents;
size_t rsDepth = 0;

static std::atomic<int32_t> g_lastMouseX{ 0 };
static std::atomic<int32_t> g_lastMouseY{ 0 };
static std::atomic<bool> g_hasMousePos{ false };
static std::atomic<xcb_connection_t *> g_recordConn{ nullptr };
static std::atomic<bool> g_stopThreads{ false };
static std::atomic<bool> g_windowThreadExists{ false };

namespace priv_os_x11
{
std::atomic<bool> g_shuttingDown{ false };
}

//whether the left mouse button on the physical is down regardless of window focus or message pump status
bool isLeftMouseDown = false;

std::mutex eventMutex;   // Locks the trackedEvents vector
std::mutex
	windowThreadMutex;   // Locks windowThread. Should NEVER be locked from inside the window thread
std::mutex rsDepthMutex;   // Locks the rsDepth variable

void WindowThread();
void RecordThread();
void StartWindowThread();

JSRectangle OSWindow::GetBounds()
{
	return GetClientBounds();
}

JSRectangle OSWindow::GetClientBounds()
{
	ensureConnection();
	xcb_generic_error_t *error = NULL;
	xcb_get_geometry_cookie_t gcookie = xcb_get_geometry(connection, this->handle);
	xcb_get_geometry_reply_t *geometry = xcb_get_geometry_reply(connection, gcookie, &error);
	if (error != NULL) {
		free(error);
		return JSRectangle();
	}
	error = NULL;
	xcb_translate_coordinates_cookie_t tcookie =
		xcb_translate_coordinates(connection, this->handle, rootWindow, 0, 0);
	xcb_translate_coordinates_reply_t *translation =
		xcb_translate_coordinates_reply(connection, tcookie, &error);
	if (error != NULL) {
		free(error);
		free(geometry);
		return JSRectangle();
	}
	auto x = translation->dst_x;
	auto y = translation->dst_y;
	auto w = geometry->width;
	auto h = geometry->height;
	free(geometry);
	free(translation);
	return JSRectangle(x, y, w, h);
}

JSPoint OSGetCursorScreenPoint()
{
	// Prefer the record-thread-derived position (works even when Electron windows never see the cursor)
	if (g_hasMousePos.load(std::memory_order_relaxed)) {
		return JSPoint((int32_t)g_lastMouseX.load(std::memory_order_relaxed),
			(int32_t)g_lastMouseY.load(std::memory_order_relaxed));
	}

	// Fallback: query pointer on root (in case record thread not running yet)
	ensureConnection();
	auto cookie = xcb_query_pointer(connection, rootWindow);
	xcb_query_pointer_reply_t *reply = xcb_query_pointer_reply(connection, cookie, NULL);
	if (!reply)
		return JSPoint(0, 0);
	JSPoint p(reply->root_x, reply->root_y);
	free(reply);
	return p;
}

float OSWindow::OSGetScale()
{
	return 1.0;
}

bool OSWindow::IsValid()
{
	if (!this->handle) {
		return false;
	}

	ensureConnection();
	xcb_get_geometry_cookie_t cookie = xcb_get_geometry_unchecked(connection, this->handle);
	std::unique_ptr<xcb_get_geometry_reply_t, decltype(&free)> reply{
		xcb_get_geometry_reply(connection, cookie, NULL), &free
	};
	return !!reply;
}

std::string OSWindow::GetTitle()
{
	ensureConnection();
	xcb_get_property_cookie_t cookie = xcb_get_property_unchecked(
		connection, 0, this->handle, XCB_ATOM_WM_NAME, XCB_ATOM_STRING, 0, 100);
	std::unique_ptr<xcb_get_property_reply_t, decltype(&free)> reply{
		xcb_get_property_reply(connection, cookie, NULL), &free
	};
	if (!reply) {
		return std::string();
	}

	char *title = reinterpret_cast<char *>(xcb_get_property_value(reply.get()));
	int length = xcb_get_property_value_length(reply.get());

	return std::string(title, length);
}

Napi::Value OSWindow::ToJS(Napi::Env env)
{
	return Napi::BigInt::New(env, (uint64_t)this->handle);
}

bool OSWindow::operator==(const OSWindow &other) const
{
	return this->handle == other.handle;
}

bool OSWindow::operator<(const OSWindow &other) const
{
	return this->handle < other.handle;
}

OSWindow OSWindow::FromJsValue(const Napi::Value jsval)
{
	auto handle = jsval.As<Napi::BigInt>();
	bool lossless;
	xcb_window_t handleint = handle.Uint64Value(&lossless);
	if (!lossless) {
		Napi::RangeError::New(jsval.Env(), "Invalid handle").ThrowAsJavaScriptException();
	}
	return OSWindow(handleint);
}

/*
 * @brief Checks if an xcb window has its size locked
 *
 * The game client itself does not lock its size, but all of the fake windows do.
 *
 * @param window The window to be checked
 *
 * @return true window has its size locked
 * @return false window does not have its size locked
 *
 */
bool HasLockedSize(const xcb_window_t window)
{
	xcb_size_hints_t hints;
	if (!xcb_icccm_get_wm_normal_hints_reply(connection,
		    xcb_icccm_get_wm_normal_hints(connection, window), &hints, nullptr)) {
		return false;
	}

	if ((hints.flags & XCB_ICCCM_SIZE_HINT_P_MIN_SIZE) &&
		(hints.flags & XCB_ICCCM_SIZE_HINT_P_MAX_SIZE)) {
		return hints.min_width == hints.max_width && hints.min_height == hints.max_height;
	}
	return false;
}

/*
 * @brief checks if the window is mapped or not
 *
 * The invisible windows should return unmapped.
 * The only danger here is that the launcher window does not return unmapped until the actual client has started,
 * and the launcher itself is closed. Until that moment, it returns viewable.
 *
 * Note: NOT Jagex Launcher, but the small RS launcher window with the graphics mode settings button.
 *
 * @param window The window to check the viewable property on
 *
 * @return true window is not unmapped
 * @return false window is unmapped
 * */
bool IsViewable(const xcb_window_t window)
{
	const auto cookie = xcb_get_window_attributes(connection, window);
	std::unique_ptr<xcb_get_window_attributes_reply_t, decltype(&free)> reply{
		xcb_get_window_attributes_reply(connection, cookie, nullptr), &free
	};
	if (!reply)
		return false;
	return reply->map_state != XCB_MAP_STATE_UNMAPPED;
}

/*
* @brief Checks if the passed window properties belong to an RS window
*
* The rs3 client can have more than one classname,
* so it is checked against preset values in rsClassNames
*
* @param title Title of the window to be checked
* @param classname classname of the window to be checked
*
* @return true classname and title belong to an RS window
* @return false no match for RS window
*/
bool IsRsWindowProperties(std::string title, std::string classname)
{
	if (title == "")
		return false;
	auto it = std::find_if(rsClassNames.begin(), rsClassNames.end(), [&](std::string_view s) {
		return (title.compare(0, strlen(rsName), rsName) == 0) && (s == classname);
	});
	return it != rsClassNames.end();
}

/*
* @brief Checks if a window is an RS window
*
* This function bases the checks on the following window properties:
* - classname and title conform to a RS string
* - window has its viewable mapped property set
* - window does NOT have its size locked
* - window is not a transient window
*
* for debugging:
*    for i in $(xdotool search "runescape|rs"); do
*        printf "${i}:\n"
*        printf "title: "
*        xdotool getwindowname "${i}"
*        printf "classname: "
*        xdotool getwindowclassname "${i}"
*        printf "processname: "
*        ps -p $(xdotool getwindowpid "${i}") -o comm=
*        xwininfo -all -id "${i}"
*        echo "---"
*    done
*
* @param window the window to check
*
* @return true window is an RS window
* @return false window is NOT an RS window
*/
bool IsRsWindow(const xcb_window_t window)
{
	ensureConnection();
	const auto cookieClass =
		xcb_get_property(connection, 0, window, XCB_ATOM_WM_CLASS, XCB_ATOM_STRING, 0, 64);
	const auto cookieTitle = xcb_get_property_unchecked(
		connection, 0, window, XCB_ATOM_WM_NAME, XCB_ATOM_STRING, 0, 64);
	const auto cookieTransient = xcb_get_property(
		connection, 0, window, XCB_ATOM_WM_TRANSIENT_FOR, XCB_ATOM_WINDOW, 0, 64);
	std::unique_ptr<xcb_get_property_reply_t, decltype(&free)> replyClass{
		xcb_get_property_reply(connection, cookieClass, NULL), &free
	};
	if (replyClass) {
		char *rsclass = reinterpret_cast<char *>(xcb_get_property_value(replyClass.get()));
		int length = xcb_get_property_value_length(replyClass.get());
		if (length == 0) {
			return false;
		}
		auto classname = std::string(rsclass, length);
		auto first = strlen(rsclass);
		classname = classname.substr(first + 1, length - first - 2);
		std::unique_ptr<xcb_get_property_reply_t, decltype(&free)> replyTitle{
			xcb_get_property_reply(connection, cookieTitle, NULL), &free
		};
		if (replyTitle) {
			char *title =
				reinterpret_cast<char *>(xcb_get_property_value(replyTitle.get()));
			int length = xcb_get_property_value_length(replyTitle.get());
			auto str_title = std::string(title, length);
			std::unique_ptr<xcb_get_property_reply_t, decltype(&free)> replyTransient{
				xcb_get_property_reply(connection, cookieTransient, NULL), &free
			};
			if (IsViewable(window) && IsRsWindowProperties(str_title, classname) &&
				!HasLockedSize(window)) {
				if (replyTransient &&
					xcb_get_property_value_length(replyTransient.get()) == 0) {
					std::cout << "Found correct RuneScape window: " << str_title
						  << std::endl;
					return true;
				} else {
					std::cout << "NonTransient window found: " << str_title
						  << std::endl;
				}
			}
		}
	}
	return false;
}

void GetRsHandlesRecursively(
	const xcb_window_t window, std::vector<OSWindow> *out, unsigned int depth = 0)
{
	xcb_query_tree_cookie_t cookie = xcb_query_tree(connection, window);
	xcb_query_tree_reply_t *reply = xcb_query_tree_reply(connection, cookie, NULL);
	if (reply == NULL) {
		return;
	}

	xcb_window_t *children = xcb_query_tree_children(reply);

	for (auto i = 0; i < xcb_query_tree_children_length(reply); i++) {
		xcb_window_t child = children[i];
		if (IsRsWindow(child)) {
			std::unique_lock<std::mutex> rsDepthLock(rsDepthMutex);
			// Only take this if it's one of the deepest instances found so far
			if (depth > rsDepth) {
				out->clear();
				out->push_back(child);
				rsDepth = depth;
			} else if (depth == rsDepth) {
				out->push_back(child);
			}
		}

		GetRsHandlesRecursively(child, out, depth + 1);
	}

	free(reply);
}

std::vector<OSWindow> OSGetRsHandles()
{
	ensureConnection();
	std::vector<OSWindow> out;
	GetRsHandlesRecursively(rootWindow, &out);
	return out;
}

void OSSetWindowParent(OSWindow window, OSWindow parent)
{
	ensureConnection();

	// If the parent handle is 0, we're supposed to detach, not attach
	if (parent.handle != 0) {
		xcb_change_property(connection, XCB_PROP_MODE_REPLACE, window.handle,
			XCB_ATOM_WM_TRANSIENT_FOR, XCB_ATOM_WINDOW, 32, 1, &parent.handle);
	} else {
		xcb_delete_property(connection, window.handle, XCB_ATOM_WM_TRANSIENT_FOR);
		xcb_flush(connection);
	}
}

void OSCaptureMulti(OSWindow wnd, CaptureMode mode, vector<CaptureRect> rects, Napi::Env env)
{
	// Ignore capture mode, XComposite will always work
	ensureConnection();
	xcb_composite_redirect_window(connection, wnd.handle, XCB_COMPOSITE_REDIRECT_AUTOMATIC);
	xcb_pixmap_t pixId = xcb_generate_id(connection);
	xcb_composite_name_window_pixmap(connection, wnd.handle, pixId);

	xcb_get_geometry_cookie_t cookie = xcb_get_geometry(connection, pixId);
	xcb_get_geometry_reply_t *reply = xcb_get_geometry_reply(connection, cookie, NULL);
	if (!reply) {
		xcb_free_pixmap(connection, pixId);
		return;
	}

	XShmCapture acquirer(connection, pixId);

	for (CaptureRect &rect : rects) {
		acquirer.copy(reinterpret_cast<char *>(rect.data), rect.size, rect.rect.x,
			rect.rect.y, rect.rect.width, rect.rect.height);
	}

	free(reply);
	xcb_free_pixmap(connection, pixId);
}

OSWindow OSGetActiveWindow()
{
	xcb_get_property_cookie_t cookie = xcb_ewmh_get_active_window(&ewmhConnection, 0);
	xcb_window_t window;
	if (xcb_ewmh_get_active_window_reply(&ewmhConnection, cookie, &window, NULL) == 0) {
		return OSWindow(0);
	}

	return OSWindow(window);
}

template <typename F, typename COND> void IterateEvents(COND cond, F callback)
{
	if (g_stopThreads.load(std::memory_order_acquire))
		return;
	std::vector<std::future<void> > futures;

	std::unique_lock<std::mutex> eventLock(eventMutex);
	for (auto &event : trackedEvents) {
		if (g_stopThreads.load(std::memory_order_acquire))
			break;
		if (cond(event)) {
			auto promise = std::make_shared<std::promise<void> >();
			futures.emplace_back(promise->get_future());

			event.callback.BlockingCall(
				[callback, promise](Napi::Env env, Napi::Function jsCallback) {
					callback(env, jsCallback);
					promise->set_value();
				});
		}
	}
	eventLock.unlock();
	if (g_stopThreads.load(std::memory_order_acquire))
		return;

	// Wait for all operations to complete
	for (auto &future : futures) {
		if (g_stopThreads.load(std::memory_order_acquire))
			break;
		future.wait();
	}
}

void OSSetWindowShape(OSWindow window, std::vector<JSRectangle> rects)
{
	ensureConnection();
	std::vector<xcb_rectangle_t> xrects;
	xrects.reserve(rects.size());
	for (size_t i = 0; i < rects.size(); i += 1) {
		xcb_rectangle_t rect;
		rect.x = rects[i].x;
		rect.y = rects[i].y;
		rect.width = rects[i].width;
		rect.height = rects[i].height;
		xrects.push_back(rect);
	}
	uint8_t ordering = 0;
	if (xrects.size() < 2)
		ordering = 3;
	//TODO this 5k x 5k special case is weird, implement separate clear call again?
	if (rects.size() == 1 && rects[0].width >= 5000 && rects[0].height >= 5000) {
		xcb_shape_mask(connection, 0, XCB_SHAPE_SK_INPUT, window.handle, 0, 0, 0);
	} else {
		xcb_shape_rectangles(connection, XCB_SHAPE_SO_SET, XCB_SHAPE_SK_INPUT, ordering,
			window.handle, 0, 0, xrects.size(), xrects.data());
	}
	xcb_flush(connection);
}

bool OSGetMouseState()
{
	return isLeftMouseDown;
}

void OSNewWindowListener(OSWindow window, WindowEventType type, Napi::Function callback)
{
	if (g_shuttingDown.load(std::memory_order_acquire) ||
		g_stopThreads.load(std::memory_order_acquire)) {
		return;
	}

	auto event = TrackedEvent(window.handle, type, callback);

	// If this is a new window, request all its events from X server
	std::unique_lock<std::mutex> eventLock(eventMutex);
	if (window.handle != 0 &&
		std::find_if(trackedEvents.begin(), trackedEvents.end(), [window](TrackedEvent &e) {
			return e.window == window.handle;
		}) == trackedEvents.end()) {
		constexpr uint32_t values[] = { XCB_EVENT_MASK_STRUCTURE_NOTIFY };
		xcb_change_window_attributes(connection, window.handle, XCB_CW_EVENT_MASK, values);
	}

	// Add the event
	trackedEvents.push_back(std::move(event));
	eventLock.unlock();

	// Start a window thread if there wasn't already one running
	StartWindowThread();
}

void OSShutdownX11()
{
	// idempotent
	bool expected = false;
	if (!g_shuttingDown.compare_exchange_strong(expected, true))
		return;

	g_stopThreads.store(true, std::memory_order_release);

	// Wake WindowThread
	if (auto rc = g_recordConn.exchange(nullptr, std::memory_order_acq_rel)) {
		xcb_disconnect(rc);
	}
	if (connection) {
		xcb_disconnect(connection);
		connection = nullptr;
	}

	// Join threads safely
	{
		std::unique_lock<std::mutex> windowThreadLock(windowThreadMutex);
		if (windowThread.joinable())
			windowThread.join();
		if (recordThread.joinable())
			recordThread.join();
		g_windowThreadExists.store(false, std::memory_order_release);
	}

	// Clean up event callbacks so TSFN doesn't keep Node alive during teardown
	{
		std::unique_lock<std::mutex> eventLock(eventMutex);
		for (auto &e : trackedEvents) {
			e.callback.Release();
			e.callbackRef.Reset();
		}
		trackedEvents.clear();
	}
}

void OSRemoveWindowListener(OSWindow window, WindowEventType type, Napi::Function callback)
{
	if (g_shuttingDown.load(std::memory_order_acquire) ||
		g_stopThreads.load(std::memory_order_acquire)) {
		// Still remove callbacks from trackedEvents so JS stops holding TSFNs
		std::unique_lock<std::mutex> eventLock(eventMutex);
		trackedEvents.erase(
			std::remove_if(trackedEvents.begin(), trackedEvents.end(),
				[window, type, callback](TrackedEvent &e) {
					if ((e.window == window.handle) && (e.type == type) &&
						(Napi::Persistent(callback) == e.callbackRef)) {
						e.callback.Release();
						e.callbackRef.Reset();
						return true;
					}
					return false;
				}),
			trackedEvents.end());
		return;
	}
	std::unique_lock<std::mutex> eventLock(eventMutex);

	// If there are no more tracked events for this window, request X server to stop sending any events about it
	if (window.handle != 0 &&
		std::find_if(trackedEvents.begin(), trackedEvents.end(), [window](TrackedEvent &e) {
			return e.window == window.handle;
		}) == trackedEvents.end()) {
		constexpr uint32_t values[] = { XCB_NONE };
		if (connection) {
			xcb_change_window_attributes_checked(
				connection, window.handle, XCB_CW_EVENT_MASK, values);
		}
	}

	bool wait = trackedEvents.size() != 0;

	// Remove any matching events
	trackedEvents.erase(std::remove_if(trackedEvents.begin(), trackedEvents.end(),
				    [window, type, callback](TrackedEvent &e) {
					    if ((e.window == window.handle) && (e.type == type) &&
						    (Napi::Persistent(callback) == e.callbackRef)) {
						    e.callback.Release();
						    return true;
					    }
					    return false;
				    }),
		trackedEvents.end());

	wait &= trackedEvents.size() == 0;
	eventLock.unlock();

	// If the window thread has nothing left to do, send it a wakeup, then wait for it to exit
	if (wait) {
		OSShutdownX11();
	}
}

bool WindowThreadShouldRun()
{
	if (g_stopThreads.load(std::memory_order_acquire))
		return false;
	std::unique_lock<std::mutex> eventLock(eventMutex);
	return !trackedEvents.empty();
}

void StartWindowThread()
{
	std::unique_lock<std::mutex> windowThreadLock(windowThreadMutex);
	if (!g_windowThreadExists.load(std::memory_order_acquire)) {
		g_windowThreadExists.store(true, std::memory_order_release);
		g_stopThreads.store(false, std::memory_order_release);
		windowThread = std::thread(WindowThread);
		recordThread = std::thread(RecordThread);
	}
}

// Should only be called from the window thread.
// Called when a window's state has changed such that it may have become eligible for tracking.
void HandleNewWindow(const xcb_window_t window, xcb_window_t parent)
{
	bool untrack = true;
	if (IsRsWindow(window)) {
		size_t depth = 0;
		while (parent != rootWindow) {
			xcb_query_tree_cookie_t cookie = xcb_query_tree(connection, parent);
			xcb_query_tree_reply_t *reply =
				xcb_query_tree_reply(connection, cookie, NULL);
			if (reply == NULL) {
				return;
			}
			parent = reply->parent;
			depth += 1;
			free(reply);
		}

		std::unique_lock<std::mutex> rsDepthLock(rsDepthMutex);
		if (depth >= rsDepth) {
			untrack = false;
			rsDepth = depth;
			rsDepthLock.unlock();
			IterateEvents(
				[](const TrackedEvent &e) {
					return e.type == WindowEventType::Show && e.window == 0;
				},
				[window](Napi::Env env, Napi::Function callback) {
					callback.Call({ Napi::BigInt::New(env, (uint64_t)window),
						Napi::Number::New(env, XCB_CREATE_NOTIFY) });
				});
		} else {
			rsDepthLock.unlock();
		}
	}

	if (untrack) {
		IterateEvents(
			[window](const TrackedEvent &e) {
				return e.type == WindowEventType::Close && e.window == window;
			},
			[](Napi::Env env, Napi::Function callback) { callback.Call({}); });
	}
}

void WindowThread()
{
	// Request substructure events for root window
	constexpr uint32_t rootValues[] = { XCB_EVENT_MASK_SUBSTRUCTURE_NOTIFY };
	xcb_change_window_attributes(connection, rootWindow, XCB_CW_EVENT_MASK, rootValues);

	xcb_generic_event_t *event;
	while (!g_stopThreads.load(std::memory_order_acquire) && WindowThreadShouldRun()) {
		event = xcb_wait_for_event(connection);
		if (event) {
			auto type = event->response_type & ~0x80;
			switch (type) {
			case 0: {
				xcb_generic_error_t *error = (xcb_generic_error_t *)event;
				if (error->error_code != 3) {
					std::cout << "native: error: code "
						  << (int)error->error_code << "; "
						  << (int)error->major_code << "."
						  << (int)error->minor_code << std::endl;
				}
				break;
			}
			case XCB_CONFIGURE_NOTIFY: {
				xcb_configure_notify_event_t *configure =
					(xcb_configure_notify_event_t *)event;
				xcb_window_t window = configure->window;

				// Translate coordinates to absolute screen space
				int16_t x = configure->x;
				int16_t y = configure->y;

				xcb_translate_coordinates_cookie_t cookie =
					xcb_translate_coordinates(
						connection, window, rootWindow, 0, 0);
				xcb_translate_coordinates_reply_t *reply =
					xcb_translate_coordinates_reply(connection, cookie, NULL);

				if (reply) {
					x = reply->dst_x;
					y = reply->dst_y;
					free(reply);
				}

				WindowState newState = { x, y, configure->width,
					configure->height };

				// Check if window actually changed
				if (windowCache.count(window)) {
					WindowState &old = windowCache[window];
					if (old.x == newState.x && old.y == newState.y &&
						old.w == newState.w && old.h == newState.h) {
						// Nothing changed (just a focus/raise event), so don't trigger JS
						break;
					}
				}
				windowCache[window] = newState;

				JSRectangle bounds =
					JSRectangle(x, y, configure->width, configure->height);

				IterateEvents(
					[window](const TrackedEvent &e) {
						return e.type == WindowEventType::Move &&
						       e.window == window;
					},
					[bounds](Napi::Env env, Napi::Function callback) {
						callback.Call({ bounds.ToJs(env),
							Napi::String::New(env, "end") });
					});
				break;
			}
			case XCB_CREATE_NOTIFY: {
				xcb_create_notify_event_t *create =
					(xcb_create_notify_event_t *)event;
				if (!create->override_redirect) {
					HandleNewWindow(create->window, create->parent);
				}
				break;
			}
			case XCB_DESTROY_NOTIFY: {
				xcb_destroy_notify_event_t *destroy =
					(xcb_destroy_notify_event_t *)event;
				xcb_window_t window = destroy->window;
				IterateEvents(
					[window](const TrackedEvent &e) {
						return e.type == WindowEventType::Close &&
						       e.window == window;
					},
					[](Napi::Env env, Napi::Function callback) {
						callback.Call({});
					});
				break;
			}
			case XCB_REPARENT_NOTIFY: {
				xcb_reparent_notify_event_t *reparent =
					(xcb_reparent_notify_event_t *)event;
				if (!reparent->override_redirect) {
					HandleNewWindow(reparent->window, reparent->parent);
				}
				break;
			}
			case XCB_EXPOSE: {
				// Not an important event, but we use XCB_EXPOSE to wake up the window thread spontaneously,
				// so it's important to catch it here
				break;
			}
			default: {
				//std::cout << "native: got event type " << type << std::endl;
				break;
			}
			}
			free(event);
		} else {
			// Fatal error - probably because the application is stopping and we need to return now
			break;
		}
	}

	g_windowThreadExists.store(false, std::memory_order_release);
	std::cout << "native: window thread exiting" << std::endl;
}

void HitTestRecursively(xcb_window_t window, int16_t x, int16_t y, int16_t offset_x,
	int16_t offset_y, xcb_window_t &out_window)
{
	xcb_query_tree_cookie_t cookie = xcb_query_tree(connection, window);
	xcb_query_tree_reply_t *reply = xcb_query_tree_reply(connection, cookie, NULL);
	if (reply == NULL) {
		return;
	}

	xcb_window_t *children = xcb_query_tree_children(reply);
	xcb_generic_error_t *error;

	for (auto i = 0; i < xcb_query_tree_children_length(reply); i++) {
		xcb_window_t child = children[i];

		error = NULL;
		xcb_get_window_attributes_cookie_t acookie =
			xcb_get_window_attributes(connection, child);
		xcb_get_window_attributes_reply_t *attributes =
			xcb_get_window_attributes_reply(connection, acookie, &error);
		if (error != NULL) {
			free(error);
			continue;
		}
		auto map_state = attributes->map_state;
		free(attributes);
		if (map_state != XCB_MAP_STATE_VIEWABLE) {
			continue;
		}

		error = NULL;
		xcb_get_geometry_cookie_t gcookie = xcb_get_geometry(connection, child);
		xcb_get_geometry_reply_t *geometry =
			xcb_get_geometry_reply(connection, gcookie, &error);
		if (error != NULL) {
			free(error);
			continue;
		}
		int16_t gx = geometry->x + offset_x;
		int16_t gy = geometry->y + offset_y;
		auto gw = geometry->width;
		auto gh = geometry->height;
		free(geometry);

		bool hit = true;
		xcb_shape_get_rectangles_cookie_t rcookie[3] = {
			// 0=ShapeBounding, 1=ShapeClip, 2=ShapeInput
			xcb_shape_get_rectangles(connection, child, 0),
			xcb_shape_get_rectangles(connection, child, 1),
			xcb_shape_get_rectangles(connection, child, 2),
		};
		xcb_shape_get_rectangles_reply_t *rectangles[3] = {
			xcb_shape_get_rectangles_reply(connection, rcookie[0], NULL),
			xcb_shape_get_rectangles_reply(connection, rcookie[1], NULL),
			xcb_shape_get_rectangles_reply(connection, rcookie[2], NULL),
		};
		if (rectangles[0] && rectangles[1] && rectangles[2]) {
			for (auto j = 0; j < 3; j += 1) {
				bool hit_shape = false;
				auto rect_count =
					xcb_shape_get_rectangles_rectangles_length(rectangles[j]);
				xcb_rectangle_t *rects =
					xcb_shape_get_rectangles_rectangles(rectangles[j]);
				for (auto k = 0; k < rect_count; k += 1) {
					xcb_rectangle_t rect = rects[k];
					hit_shape |= (x >= (rect.x + gx) &&
						      x < (rect.x + rect.width + gx) &&
						      y >= (rect.y + gy) &&
						      y < (rect.y + rect.height + gy));
				}
				hit &= hit_shape;
			}
		} else {
			hit = (x >= gx && x < (gx + gw) && y >= gy && y < (gy + gh));
		}
		free(rectangles[0]);
		free(rectangles[1]);
		free(rectangles[2]);

		if (hit) {
			out_window = child;
			HitTestRecursively(child, x, y, gx, gy, out_window);
		}
	}

	free(reply);
}

// To be called from Record thread. Recursively finds the topmost window which passes hit test at given root coordinates
xcb_window_t HitTest(int16_t x, int16_t y)
{
	xcb_window_t out = rootWindow;
	HitTestRecursively(rootWindow, x, y, 0, 0, out);
	return out;
}

void RecordThread()
{
	// Second event thread for using the X Record API, which we need to receive mouse button events
	const xcb_query_extension_reply_t *ext = xcb_get_extension_data(connection, &xcb_record_id);
	if (!ext) {
		std::cerr
			<< "native: X record extension is not supported; some features will not work"
			<< std::endl;
		return;
	}

	xcb_record_query_version_reply_t *version_reply = xcb_record_query_version_reply(connection,
		xcb_record_query_version(
			connection, XCB_RECORD_MAJOR_VERSION, XCB_RECORD_MINOR_VERSION),
		NULL);
	if (version_reply) {
		std::cout << "native: X record extension version: " << version_reply->major_version
			  << "." << version_reply->minor_version << std::endl;
		free(version_reply);
	} else {
		std::cout << "native: X record extension version is unknown" << std::endl;
	}

	auto id = xcb_generate_id(connection);
	xcb_record_range_t range;
	memset(&range, 0, sizeof(xcb_record_range_t));
	range.device_events.first = XCB_BUTTON_PRESS;
	// range.device_events.last = XCB_BUTTON_RELEASE;
	range.device_events.last = XCB_MOTION_NOTIFY;
	xcb_record_client_spec_t client_spec = XCB_RECORD_CS_ALL_CLIENTS;
	xcb_void_cookie_t cookie =
		xcb_record_create_context_checked(connection, id, 0, 1, 1, &client_spec, &range);
	xcb_generic_error_t *error = xcb_request_check(connection, cookie);
	if (error) {
		std::cout
			<< "native: couldn't setup X record: xcb_record_create_context_checked returned "
			<< (int)error->error_code << " (sequence: " << error->sequence
			<< "); some features will not work" << std::endl;
		free(error);
		return;
	}

	auto rec_connection = xcb_connect(NULL, NULL);
	if (xcb_connection_has_error(rec_connection)) {
		std::cout
			<< "native: couldn't start record thread connection; some features will not work"
			<< std::endl;
		return;
	}
	g_recordConn.store(rec_connection, std::memory_order_release);

	auto cookie2 = xcb_record_enable_context(rec_connection, id);

	// xcb-record event loop
	while (!g_stopThreads.load(std::memory_order_acquire) && WindowThreadShouldRun()) {
		auto *reply = xcb_record_enable_context_reply(rec_connection, cookie2, NULL);
		if (!reply) {
			if (!g_stopThreads.load(std::memory_order_acquire)) {
				std::cout << "native: error in xcb_record_enable_context_reply"
					  << std::endl;
			}
			break;
		}
		if (reply->client_swapped) {
			std::cout
				<< "native: unsupported setting client_swapped; please report this error"
				<< std::endl;
			break;
		}

		// 0 is XRecordFromServer; we also receive 4 (XRecordStartOfData) at the start of execution, and
		// 5 (XRecordEndOfData) when we invalidate the main connection, which works as this thread's end-wakeup
		if (reply->category == 0) {
			uint8_t *data = xcb_record_enable_context_data(reply);
			int data_len = xcb_record_enable_context_data_length(reply);
			if (data_len == sizeof(xcb_button_press_event_t)) {
				xcb_generic_event_t *ev = (xcb_generic_event_t *)data;
				switch (ev->response_type & ~0x80) {
				case XCB_BUTTON_PRESS: {
					xcb_button_press_event_t *event =
						(xcb_button_press_event_t *)ev;
					auto button = event->detail;
					if (button == 1 || button == 3) {
						isLeftMouseDown = button == 1;
						int16_t click_x = event->root_x;
						int16_t click_y = event->root_y;
						JSPoint point = JSPoint(click_x, click_y);
						xcb_window_t hit = HitTest(click_x, click_y);
						IterateEvents(
							[hit](const TrackedEvent &e) {
								return e.type == WindowEventType::
											 Click &&
								       e.window == hit;
							},
							[point](Napi::Env env,
								Napi::Function callback) {
								callback.Call({ point.ToJs(env) });
							});
					}
					break;
				}
				case XCB_BUTTON_RELEASE: {
					xcb_button_press_event_t *event =
						(xcb_button_press_event_t *)ev;
					auto button = event->detail;
					if (isLeftMouseDown && button == 1) {
						isLeftMouseDown = false;
					}
					break;
				}
				case XCB_MOTION_NOTIFY: {
					// std::cout << "motion notify" << std::endl;
					xcb_motion_notify_event_t *event =
						(xcb_motion_notify_event_t *)ev;
					g_lastMouseX.store(
						event->root_x, std::memory_order_relaxed);
					g_lastMouseY.store(
						event->root_y, std::memory_order_relaxed);
					g_hasMousePos.store(true, std::memory_order_relaxed);
					int16_t move_x = event->root_x;
					int16_t move_y = event->root_y;
					JSPoint point = JSPoint(move_x, move_y);
					xcb_window_t hit = HitTest(move_x, move_y);
					IterateEvents(
						[hit](const TrackedEvent &e) {
							return e.type ==
								       WindowEventType::MouseMove &&
							       e.window == hit;
						},
						[point](Napi::Env env, Napi::Function callback) {
							callback.Call({ point.ToJs(env) });
						});
					break;
				}
				}
			}
		}
		if (reply)
			free(reply);
	}

	xcb_connection_t *expected = rec_connection;
	std::cout << "native: record thread exiting" << std::endl;
	const bool stillOwned =
		g_recordConn.compare_exchange_strong(expected, nullptr, std::memory_order_acq_rel);

	if (stillOwned) {
		xcb_record_disable_context(rec_connection, id);
		xcb_record_free_context(rec_connection, id);
		xcb_flush(rec_connection);
		xcb_disconnect(rec_connection);
	} else {
		// Already disconnected by shutdown path.
	}
}

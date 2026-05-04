#import <cstring>
#import <iostream>
#import <vector>
#import <CoreGraphics/CoreGraphics.h>
#import "os.h"
#import "mac/AOUtil.h"

static std::atomic<int32_t> g_lastMouseX{ 0 };
static std::atomic<int32_t> g_lastMouseY{ 0 };
static std::atomic<bool> g_hasMousePos{ false };

typedef struct filterData {
	vector<OSWindow> wins;
	CGWindowID windowId;
	CFStringRef windowName;
	CFStringRef prefix;
} filterData;

static NSScreen *GetPrimaryScreen()
{
	for (NSScreen *screen in [NSScreen screens]) {
		if (NSEqualPoints(screen.frame.origin, NSZeroPoint)) {
			return screen;
		}
	}
	return [NSScreen screens][0];   // fallback
}

static CGRect GetNativeBounds(OSRawWindow handle)
{
	CFDictionaryRef windowInfo = [AOUtil findWindow:handle.winid];
	if (windowInfo == nullptr) {
		return [GetPrimaryScreen frame];
	}
	CGRect bounds;
	CGRectMakeWithDictionaryRepresentation(
		(CFDictionaryRef)CFDictionaryGetValue(windowInfo, kCGWindowBounds), &bounds);
	return bounds;
}

static CGRect FlipY(CGRect rect)
{
	CGFloat totalHeight = 0;
	for (NSScreen *screen in [NSScreen screens]) {
		CGFloat bottom = screen.frame.origin.y + screen.frame.size.height;
		if (bottom > totalHeight)
			totalHeight = bottom;
	}
	rect.origin.y = totalHeight - rect.origin.y - rect.size.height;
	return rect;
}

JSRectangle OSWindow::GetBounds()
{
	CGRect r = FlipY(GetNativeBounds(this->handle));
	float scale = OSGetScale();
	return JSRectangle(r.origin.x / scale, r.origin.y / scale, r.size.width / scale,
		r.size.height / scale);
}

JSRectangle OSWindow::GetClientBounds()
{
	CGRect r = FlipY(GetNativeBounds(this->handle));
	BOOL isFs = [AOUtil isFullScreen:GetNativeBounds(this->handle)];
	JSRectangle jbounds(r.origin.x, r.origin.y, r.size.width, r.size.height);
	if (!isFs) {
		jbounds.y += TITLE_BAR_HEIGHT;
		jbounds.height -= TITLE_BAR_HEIGHT;
	}
	return jbounds;
}

float OSWindow::OSGetScale()
{
	CFDictionaryRef windowInfo = [AOUtil findWindow:this->handle.winid];
	if (windowInfo == nullptr) {
		return 1.0;
	}
	CGRect screenBounds;
	CGRectMakeWithDictionaryRepresentation(
		(CFDictionaryRef)CFDictionaryGetValue(windowInfo, kCGWindowBounds), &screenBounds);
	return static_cast<float>(
		[AOUtil findScalingFactor:[AOUtil findScreenForRect:screenBounds]]);
}

void filterWindows(const void *inputDictionary, void *context)
{
	if (context == NULL) {
		return;
	}
	CFDictionaryRef entry = (CFDictionaryRef)inputDictionary;
	filterData *data = (filterData *)context;
	if (data->windowId != 0) {
		CFNumberRef value = (CFNumberRef)CFDictionaryGetValue(entry, kCGWindowNumber);
		CGWindowID windowId;
		CFNumberGetValue(value, kCFNumberIntType, &windowId);
		if (data->windowId == windowId) {
			data->wins.push_back(OSWindow(OSRawWindow{ .winid = windowId }));
		}
	} else {
		// Grab the window name, but since it's optional we need to check before we can use it.
		CFStringRef windowName = (CFStringRef)CFDictionaryGetValue(entry, kCGWindowName);
		if (CFStringGetLength(data->windowName) > 0) {
			CFIndex windowNameLen =
				windowName == NULL ? 0 : CFStringGetLength(windowName);
			if (windowNameLen == 0 ||
				kCFCompareEqualTo != CFStringCompare(windowName, data->windowName,
							     kCFCompareCaseInsensitive)) {
				return;
			}
		}
		// Grab the application name, but since it's optional we need to check before we can use it.
		CFStringRef applicationName =
			(CFStringRef)CFDictionaryGetValue(entry, kCGWindowOwnerName);
		if (applicationName != NULL && data->prefix != NULL) {
			bool hasPrefix = CFStringHasPrefix(applicationName, data->prefix);
			if (!hasPrefix) {
				return;
			}
		}
		CFNumberRef appPidRef = (CFNumberRef)CFDictionaryGetValue(entry, kCGWindowOwnerPID);
		pid_t pid;
		CFNumberGetValue(appPidRef, kCFNumberIntType, &pid);

		// Grab the Window Bounds, it's a dictionary in the array, but we want to display it as a string
		CFNumberRef alphaValueRef =
			(CFNumberRef)CFDictionaryGetValue(entry, kCGWindowAlpha);
		CGFloat alpha;
		CFNumberGetValue(alphaValueRef, kCFNumberCGFloatType, &alpha);

		// Grab the Window ID
		CFNumberRef value = (CFNumberRef)CFDictionaryGetValue(entry, kCGWindowNumber);
		CGWindowID windowId;
		CFNumberGetValue(value, kCFNumberIntType, &windowId);
		if (alpha > 0) {
			data->wins.push_back(OSWindow(OSRawWindow{ .winid = windowId }));
		}
	}
}

vector<OSWindow> OSGetRsHandles()
{
	CFArrayRef windowList = CGWindowListCopyWindowInfo(
		kCGWindowListOptionAll | kCGWindowListExcludeDesktopElements, kCGNullWindowID);

	filterData *windowFilterData = new filterData;
	windowFilterData->wins = vector<OSWindow>();
	windowFilterData->windowId = 0;
	windowFilterData->windowName = CFSTR("runescape");
	windowFilterData->prefix = CFSTR("rs2client");

	CFArrayApplyFunction(windowList, CFRangeMake(0, CFArrayGetCount(windowList)),
		&filterWindows, (void *)(windowFilterData));
	return windowFilterData->wins;
}

OSWindow OSGetActiveWindow()
{
	pid_t pid = [AOUtil focusedPid];
	CGWindowID windowId = [AOUtil appFocusedWindow:pid];
	return OSWindow(OSRawWindow{ .winid = windowId });
}

bool OSWindow::IsValid()
{
	return this->handle.winid != 0;
}

std::string OSWindow::GetTitle()
{
	auto windowId = static_cast<CGWindowID>(this->handle.winid);
	NSString *title = [AOUtil appTitle:[AOUtil pidForWindow:windowId]];
	std::string stdtitle;
	if ([title length] == 0) {
		return stdtitle;
	}
	stdtitle = std::string([title cStringUsingEncoding:kCFStringEncodingUTF8], [title length]);
	return stdtitle;
}

Napi::Value OSWindow::ToJS(Napi::Env env)
{
	return Napi::BigInt::New(env, static_cast<uint64_t>(this->handle.winid));
}

bool OSWindow::operator==(const OSWindow &other) const
{
	return memcmp(&this->handle, &other.handle, sizeof(this->handle)) == 0;
}

bool OSWindow::operator<(const OSWindow &other) const
{
	return memcmp(&this->handle, &other.handle, sizeof(this->handle)) < 0;
}

OSWindow OSWindow::FromJsValue(const Napi::Value jsval)
{
	auto handle = jsval.As<Napi::BigInt>();
	bool lossless;
	uint64_t handleint = handle.Uint64Value(&lossless);
	if (!lossless) {
		Napi::RangeError::New(jsval.Env(), "Invalid handle").ThrowAsJavaScriptException();
	}
	return OSWindow(OSRawWindow{ .winid = handleint });
}

void OSSetWindowParent(OSWindow wnd, OSWindow parent)
{
	[AOUtil macOSSetParent:parent forWindow:wnd];
}

/**
 * Defines which region of a window can be clicked
 * Implemented only on X11 Linux as a replacement for electron's setIgnoreMouseEvents()
 */
void OSSetWindowShape(
	__attribute__((unused)) OSWindow wnd, __attribute__((unused)) vector<JSRectangle> rects)
{
	//No op on macos
}

/**
 * Returns true when the left/main mouse button is down, even in another process and regardless of message pump state
 */
bool OSGetMouseState()
{
	return [AOUtil macOSGetMouseState];
}

void OSCaptureMulti(OSWindow wnd, __attribute__((unused)) CaptureMode mode,
	vector<CaptureRect> rects, __attribute__((unused)) Napi::Env env)
{
	[AOUtil capture:wnd withRects:rects];
}

static Napi::ThreadSafeFunction g_nodeThreadTsfn;

void OSNewWindowListener(OSWindow wnd, WindowEventType type, Napi::Function callback)
{
	if (wnd.handle.winid == 0 && type != WindowEventType::Show) {
		return;
	}

	// If g_nodeThreadTsfn is uninitialized, we're being called directly
	// from JS on the Node thread — safe to create TSFNs
	if (!g_nodeThreadTsfn) {
		auto dummy = Napi::Function::New(callback.Env(), [](const Napi::CallbackInfo &) {});
		g_nodeThreadTsfn = Napi::ThreadSafeFunction::New(
			callback.Env(), dummy, "nodethread", 0, 1, [](Napi::Env) {});
	}

	CGWindowID winid = (CGWindowID)wnd.handle.winid;
	WindowEventType capturedType = type;

	auto persistedRef = std::make_shared<Napi::FunctionReference>(Napi::Persistent(callback));

	g_nodeThreadTsfn.NonBlockingCall([persistedRef, winid, capturedType](
						 Napi::Env env, Napi::Function) {
		auto tsfn =
			std::make_shared<Napi::ThreadSafeFunction>(Napi::ThreadSafeFunction::New(
				env, persistedRef->Value(), "event", 0, 1, [](Napi::Env) {}));
		auto ref = persistedRef;
		dispatch_async(dispatch_get_main_queue(), ^{
			[AOUtil macOSNewWindowListener:winid type:capturedType tsfn:tsfn ref:ref];
		});
	});
}

void OSRemoveWindowListener(OSWindow wnd, WindowEventType type, Napi::Function callback)
{
	[AOUtil macOSRemoveWindowListener:(CGWindowID)wnd.handle.winid type:type callback:callback];
}

JSPoint OSGetCursorScreenPoint()
{
	if (g_hasMousePos.load(std::memory_order_relaxed)) {
		return JSPoint((int32_t)g_lastMouseX.load(std::memory_order_relaxed),
			(int32_t)g_lastMouseY.load(std::memory_order_relaxed));
	}

	CGEventRef event = CGEventCreate(NULL);
	if (!event)
		return JSPoint(0, 0);

	CGPoint pt = CGEventGetLocation(event);
	CFRelease(event);

	return JSPoint(static_cast<int32_t>(pt.x), static_cast<int32_t>(pt.y));
}

#pragma once
#include <thread>
#include <vector>
#include <xcb/xcb.h>
#include <xcb/xcb_ewmh.h>
#include <atomic>

namespace priv_os_x11
{
extern xcb_connection_t *connection;
extern xcb_window_t rootWindow;
extern xcb_ewmh_connection_t ewmhConnection;
extern std::atomic<bool> g_shuttingDown;

/**
	 * Ensure that we have connection to X11
	 */
void ensureConnection();

xcb_atom_t getAtom(const char *name);
}   // namespace priv_os_x11

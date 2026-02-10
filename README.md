
This is a fork! For any questions or bugs you'd like to see fixed, please file an issue or discussion here or shoot a message to the official alt1 discord. You can also message me directly on discord to `arrowsin`.

## Wayland
If you're using wayland, the compositor is unaware of any positioning that `alt1-electron` does or tries to do, due to the wayland devs not wanting windows to determine their own position, instead leaving it to the user. For Hyprland (tiling window manager) for instance, specific windowrules are required to at least:
- Pin the window
- Disable any blur
- Fix the position and size
- Also fix the position and size of the rs client (or create a hook that makes them follow each other's sizes and positions)
- Set the window to not be tiled
- Disable any borders

On other non-tiling desktop/window managers such as KDE and gnome, it should be more straightforward, though the position issues remain.

There is also one bug with the Runescape launcher when using xwayland, as it keeps open its launcher window (the one with the loading progress bar), which is only visible to xwayland and not to wayland. There is one workaround for this in commit `c9e83c3`, which checks for a window with the exact same window title and class as the 'real' Runescape client, but with a fixed size of 720x480. DO NOT RESIZE THE LAUNCHER WINDOW AND DO NOT RESIZE YOUR CLIENT TO 720x480, this will break alt1-electron. Without the workaround, alt1-electron will hook onto both the real client and the phantom window, causing it to fail as the phantom window does not have any rs information. Any better suggestions for fixing this than using the window size are appreciated. It can also be solved by using a hook script on opening the rs3 window, using `xdotool` to close the fake/phantom window once the rs3 window is opened, this is out of scope for adding to this project though.

# Alt1 Electron (name pending)
This project is an experimental rewrite of the Alt1 Toolkit in Typescript, Electron and React. The project is currently in an experimental state, it will likely not become a replacement for C# Alt1 since the official devs have found their own solutions for the C# issues that were originally presented.

# Build
You need a working nodejs installation including nodejs native build tools (is an option during installation) in order to compile Alt1.
```sh
# Install dependencies
npm ci

# Build native modules
# After building once you will find cpp project files for visual studio/xcode depending on your platform
# You can then build and debug using that project and IDE
npm run native

# build typescript/webpack (requires nodejs >22.6)
npm run build

# Run
npm run ui

# To create an appImage/portable exe/darwin zip (darwin is not officially supported yet):
npm run dist

# For development only, replace npm run build with:
npm run watch
```

## Linux dependencies

- [libxcb](https://xcb.freedesktop.org/) with the Composite and SHM extensions
- [libxcb-wm](https://gitlab.freedesktop.org/xorg/lib/libxcb-wm)
- [pkg-config](https://www.freedesktop.org/wiki/Software/pkg-config/)

### Arch (pacman)

```console
# pacman -S pkg-config libxcb xcb-util-wm
```

### Debian/Ubuntu (apt)

```console
# apt install pkg-config libxcb-shm0-dev libxcb-composite0-dev libxcb-ewmh-dev libxcb-record0-dev libxcb-shape0-dev
```

### Gentoo (portage)

```console
# emerge --ask --noreplace dev-util/pkgconf x11-libs/libxcb x11-libs/xcb-util-wm
```

### Nix (flake)

To run the flake:

```console
nix run .#alt1-toolkit
```

Also works in a .desktop file: (fill in the install dir yourself)
```console
[Desktop Entry]
Name=Alt1Toolkit
Exec=nix run <INSTALL DIR>#alt1-toolkit -- %u
Type=Application
Terminal=false
Categories=Application;
Icon=<INSTALL DIR>/src/imgs/alt1icon.png
Comment=Launch Alt1 electron toolkit
StartupWMClass=Alt1Toolkit
```

`nix run github:arroquw/alt1-electron` should also work

# Why rewrite?

### Browser integration
Currently communication with apps is slow and limited. Electron has much better browser integration for stuff like error handling and complex data types. There is also the option for service worker integration and a native API to offload high performance code.

### Cross-platform
This has been the most long standing request. Starting from scratch with other platforms in mind is an order of magnitude easier than trying to backport it. Electron is cross-platform by default, so only minimal platform specific code is needed.

# Project status

See [contributing.md](./contributing.md) for information on how to contribute to this project.

**Currently functional**
- [x] Basic app functionality
- [x] Overlay API
- [x] Capture API
- [x] Appconfig and saved apps
- [x] Window pinning
- [x] Multiclient support
- [x] OpenGL capture using old DLLs
- [x] mp4 works! (twitch)
	- [ ] still no widevine CDM so no netflix
- [x] changes in app libs use new fast capture API
- [x] rightclick detection
- [x] basic alt+1 hotkey detection
- [ ] Toolbar
- [ ] Settings window
	- [ ] installed apps
	- [ ] capture mode previews and troubleshoot
- [ ] add app window
- [ ] browser handlers
	- [ ] alt1:// protocol from internal browser
	- [ ] remove toolbar on popups
	- [ ] rightclick menu
- [ ] Rewrite and publish OpenGL capture
- [ ] App resize visual snapping
- [ ] Shippableness in general
- [x] alt+1 hotkey
	- [x] app triggers
- [ ] statusdaemon
- [ ] Independent modules
	- [ ] Screenshot sharing (alt+2)
	- [ ] Window manipulation tool (alt+3)

**Platform specific**
- [x] Windows
	- [x] Basics
	- [x] Window events API
	- [x] Window pinning
	- [x] Capture
		- [x] OpenGL
		- [x] Window
		- [ ] UI to toggle during runtime
- [x] Linux
	- [x] Basics
	- [x] Window events API
	- [x] Window pinning
	- [x] Capture
		- [x] Window
- [ ] MacOS
	- [ ] Basics
	- [ ] Window events API
	- [ ] Window pinning
	- [ ] Capture
		- [ ] Window

**TODO**
- [ ] Actually implement capture method toggle
- [ ] Add toggle in Injectdll for rgba capture instead of bgra
- [ ] Improve RS client close detection
- [x] Fix RS client opening detection pinning on the loading screen
- [ ] Get rid of electron resize handles
- [ ] App frame css
- [ ] Many little used api calls
- [ ] Clean up native event situation for windows
- [ ] Enable contextisolation in appwindow
- [ ] Try to move RS specific constants from native code to ts/config files
- [ ] Think some more about the name

# Extension projects
These concepts don't exist in C# Alt1 but are now possible.

### Background apps
App functionality that runs without the app being visible using service workers.

### Native acceleration plugin
Direct access to JS runtime and memory of arraybuffers is now possible. Possibly capture directly into app controlled memory and implement C++ accelerated image detect fast paths.

### Different app styles
Support for Guide style apps that are easy to minimize and take up the center screen. In 2019, RS Pocketbook was interested in merging into Alt1 like this, others are also possible.

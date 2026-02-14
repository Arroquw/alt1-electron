export const getHydrationScript = (alt1API: any) => {
    // We stringify the initial state so the injected script has the data
    const apiData = JSON.stringify(alt1API);

    return `
        (function() {
            const bridge = window.alt1Internal;
            if (!bridge) {
                console.error("Alt1 Error: Internal bridge not found");
                return;
            }

            let lastRsInfo = null;
            let lastRsInfoTime = 0;

            function getRsInfo() {
                if (lastRsInfoTime < Date.now() - 100) {
                    lastRsInfo = window.electronIPC.sendSync("rsbounds");
                    lastRsInfoTime = Date.now();
                }
                if (lastRsInfo.error) throw new Error(lastRsInfo.error);
                return lastRsInfo.value;
            }

            const getters = {
                rsX: { get() { return getRsInfo().clientRect.x; } },
                rsY: { get() { return getRsInfo().clientRect.y; } },
                rsWidth: { get() { return getRsInfo().clientRect.width; } },
                rsHeight: { get() { return getRsInfo().clientRect.height; } },
                rsActive: { get() { return getRsInfo().active; } },
                rsLastActive: { get() { return Date.now() - getRsInfo().lastActiveTime; } },
                rsPing: { get() { return getRsInfo().ping; } },
                rsScaling: { get() { return getRsInfo().scaling; } },
                rsLinked: { get() { return true; } }, //can no longer open apps without rs
                captureMethod: { get() { return getRsInfo().captureMode; } },
                mousePosition: { get() { return getRsInfo().mousePosition; } },
                //TODO
                currentWorld: { get() { return 1; } },
                lastWorldHop: { get() { return 0; } },
                permissionGameState: { get() { return true; } },
                permissionInstalled: { get() { return true; } },
                permissionOverlay: { get() { return true; } },
                permissionPixel: { get() { return true; } }
            };

            window.alt1 = window.alt1 || {};
            Object.defineProperties(window.alt1, getters);

            Object.keys(bridge).forEach((key) => {
                const descriptor = Object.getOwnPropertyDescriptor(bridge, key);
                if (descriptor && (descriptor.get || typeof bridge[key] === 'function')) {
                    Object.defineProperty(window.alt1, key, {
                        get: () => bridge[key],
                        enumerable: true,
                        configurable: true
                    });
                } else {
                    window.alt1[key] = bridge[key];
                }
            });

            window.alt1.events = {};
            console.log("Alt1 hydrated in Webview Main World!");
        })();
    `;
};

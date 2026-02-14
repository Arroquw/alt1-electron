export const getHydrationScript = (alt1API: any) => {
    // We stringify the initial state so the injected script has the data
    const apiData = JSON.stringify(alt1API);

    return `
        (function() {
            const bridge = window.alt1Internal;
            const ipc = window.electronIPC;

            const alt1 = {
                events: {},
            };

            let lastRsInfo = null;
            let lastRsInfoTime = 0;

            function getRsInfo() {
                if (lastRsInfoTime < Date.now() - 100) {
                    lastRsInfo = ipc.sendSync("rsbounds");
                    lastRsInfoTime = Date.now();
                }
                if (lastRsInfo.error) throw new Error(lastRsInfo.error);
                return lastRsInfo.value;
            }

            Object.defineProperties(alt1, {
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
            });

            Object.keys(bridge).forEach((key) => {
                if (typeof bridge[key] === "function") {
                    alt1[key] = bridge[key].bind(bridge);
                } else if (!(key in alt1)) {
                    alt1[key] = bridge[key];
                }
            });

            window.alt1 = alt1;
            console.log("Alt1 hydrated in Webview Main World!");
        })();
    `;
};

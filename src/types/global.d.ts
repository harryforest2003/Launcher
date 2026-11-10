export {};

// Window.launcherAPI and PlayerSearchResult are declared in electron.d.ts.
// Declaring them here as well produced two conflicting `launcherAPI` shapes,
// which silently hid every method except getInstances/createInstance.

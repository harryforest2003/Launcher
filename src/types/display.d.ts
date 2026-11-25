export {};

declare global {
    interface Window {
        /** The launcher's window: full screen and page zoom (missing in the web preview). */
        displayAPI?: {
            /** In (true) or out (false) of full screen; nothing only asks. Answers whether it is. */
            fullScreen(on?: boolean): Promise<boolean>;
            onFullScreen(listener: (on: boolean) => void): () => void;
            /** Chromium's page zoom, 0.5 to 2. */
            setZoom(factor: number): void;
        };
    }
}

class SkinRotationManager {
    private rotation = 0;
    private lastTime = performance.now();

    constructor() {
        this.animate();
    }

    private animate = () => {
        const now = performance.now();
        const delta = (now - this.lastTime) / 1000;

        this.lastTime = now;

        // 12 degrees per second
        this.rotation += delta * 12;

        if (this.rotation > 360) {
            this.rotation -= 360;
        }

        requestAnimationFrame(this.animate);
    };

    getRotation() {
        return this.rotation;
    }
}

export default new SkinRotationManager();
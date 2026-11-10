export default class CursorTracker {

    private targetX = 0;
    private targetY = 0;

    private currentX = 0;
    private currentY = 0;

    public focused = false;

    set(x: number, y: number) {
        this.targetX = x;
        this.targetY = y;
    }

    update() {

        const lerpSpeed = this.focused ? 0.15 : 0.08;

        this.currentX += (this.targetX - this.currentX) * lerpSpeed;
        this.currentY += (this.targetY - this.currentY) * lerpSpeed;
    }

    getYaw() {
        const strength = this.focused ? 0.7 : 0.45;
        return this.currentX * strength;
    }

    getPitch() {
        const strength = this.focused ? 0.35 : 0.25;
        return -this.currentY * strength;
    }

    setFocused(state: boolean) {
        this.focused = state;
    }
}
export default class AnimationController {

    private walkTime = 0;
    private idleTime = 0;

    public walking = false;
    public hovered = false;

    private rotation = 0;

    update(delta: number) {
        this.walkTime += delta;
        this.idleTime += delta;
    }

    // -------------------------
    // INTERNAL WAVE FUNCTION
    // -------------------------
    private swing(speed: number, offset: number) {
        return Math.sin(this.walkTime * speed + offset);
    }

    // -------------------------
    // ARM SWING (MINECRAFT PHASED)
    // -------------------------
    getRightArmSwing() {
        if (!this.walking) return 0;
        return this.swing(8, 0) * 0.65;
    }

    getLeftArmSwing() {
        if (!this.walking) return 0;
        return this.swing(8, Math.PI) * 0.65;
    }

    // -------------------------
    // LEG SWING (OPPOSITE PHASE)
    // -------------------------
    getRightLegSwing() {
        if (!this.walking) return 0;
        return this.swing(8, Math.PI) * 0.65;
    }

    getLeftLegSwing() {
        if (!this.walking) return 0;
        return this.swing(8, 0) * 0.65;
    }

    // -------------------------
    // BODY BOB (WALK IMPACT)
    // -------------------------
    getBodyBob() {
        if (!this.walking) return 0;
        return Math.abs(Math.sin(this.walkTime * 8)) * 0.25;
    }

    // -------------------------
    // IDLE BREATHING
    // -------------------------
    getIdleBreathing() {
        return Math.sin(this.idleTime * 1.5) * 0.05;
    }

    // -------------------------
    // HEAD TILT (OPTIONAL USE)
    // -------------------------
    getHeadIdleTilt() {
        return Math.sin(this.idleTime * 0.8) * 0.03;
    }

    // -------------------------
    // HOVER ROTATION (SKIN GRID)
    // -------------------------
    setHovered(state: boolean) {
        this.hovered = state;
    }

    getRotation(delta: number) {
        if (this.hovered) return this.rotation;

        this.rotation += delta * 0.6;
        return this.rotation;
    }

    resetRotation() {
        this.rotation = 0;
    }
}
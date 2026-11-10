export default class RotationManager {

    private static angle = 0;

    private static speed = 0.35;

    static update(delta: number) {

        this.angle += delta * this.speed;

    }

    static getRotation() {

        return this.angle;

    }

}
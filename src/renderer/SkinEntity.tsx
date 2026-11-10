// SkinEntity.ts
import * as THREE from "three";
import AnimationController from "./AnimationController";
import CursorTracker from "./CursorTracker";

export default class SkinEntity {

    public root = new THREE.Group();

    private animation = new AnimationController();
    private cursor = new CursorTracker();

    private head!: THREE.Group;
    private body!: THREE.Group;
    private leftArm!: THREE.Group;
    private rightArm!: THREE.Group;
    private leftLeg!: THREE.Group;
    private rightLeg!: THREE.Group;

    constructor() {}

    setParts(parts: {
        head: THREE.Group;
        body: THREE.Group;
        leftArm: THREE.Group;
        rightArm: THREE.Group;
        leftLeg: THREE.Group;
        rightLeg: THREE.Group;
    }) {
        this.head = parts.head;
        this.body = parts.body;
        this.leftArm = parts.leftArm;
        this.rightArm = parts.rightArm;
        this.leftLeg = parts.leftLeg;
        this.rightLeg = parts.rightLeg;

        this.root.add(
            this.head,
            this.body,
            this.leftArm,
            this.rightArm,
            this.leftLeg,
            this.rightLeg
        );
    }

    setWalking(state: boolean) {
        this.animation.walking = state;
    }

    setCursor(x: number, y: number) {
        this.cursor.set(x, y);
    }

    update(delta: number) {

        this.animation.update(delta);
        this.cursor.update();

        // AnimationController exposes per-limb swings, not generic
        // getArmSwing/getLegSwing (which never existed).
        const bob = this.animation.getBodyBob();

        // WALKING
        this.leftArm.rotation.x = this.animation.getLeftArmSwing();
        this.rightArm.rotation.x = this.animation.getRightArmSwing();

        this.leftLeg.rotation.x = this.animation.getLeftLegSwing();
        this.rightLeg.rotation.x = this.animation.getRightLegSwing();

        this.body.position.y = bob;

        // HEAD LOOK
        this.head.rotation.y = this.cursor.getYaw();
        this.head.rotation.x = this.cursor.getPitch();

        // IDLE BREATHING
        const breath = this.animation.getIdleBreathing();
        this.body.position.y += breath;
    }
}
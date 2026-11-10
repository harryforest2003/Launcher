import * as THREE from "three";
import { createLayeredPart } from "./CubeBuilder";
import { HEAD, HAT, BODY, JACKET, RIGHT_ARM, RIGHT_SLEEVE, RIGHT_LEG, RIGHT_PANTS } from "./SkinLayout";

export default class PlayerModel {

    public root = new THREE.Group();

    public head!: THREE.Group;
    public body!: THREE.Group;
    public leftArm!: THREE.Group;
    public rightArm!: THREE.Group;
    public leftLeg!: THREE.Group;
    public rightLeg!: THREE.Group;

    public headHat!: THREE.Group;
    public jacket!: THREE.Group;
    public leftSleeve!: THREE.Group;
    public rightSleeve!: THREE.Group;
    public leftPants!: THREE.Group;
    public rightPants!: THREE.Group;

    constructor(texture: THREE.Texture) {

        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.flipY = false;

        // ---------- HEAD ----------
        const head = createLayeredPart(
            {
                width: 8,
                height: 8,
                depth: 8,
                texture,
                uv: HEAD,
                position: new THREE.Vector3(0, 24, 0),
                pivot: new THREE.Vector3(0, 0, 0)
            },
            {
                width: 8,
                height: 8,
                depth: 8,
                texture,
                uv: HAT,
                position: new THREE.Vector3(0, 24, 0),
                pivot: new THREE.Vector3(0, 0, 0)
            }
        );

        // ---------- BODY ----------
        const body = createLayeredPart(
            {
                width: 8,
                height: 12,
                depth: 4,
                texture,
                uv: BODY,
                position: new THREE.Vector3(0, 12, 0),
                pivot: new THREE.Vector3(0, 0, 0)
            },
            {
                width: 8,
                height: 12,
                depth: 4,
                texture,
                uv: JACKET,
                position: new THREE.Vector3(0, 12, 0),
                pivot: new THREE.Vector3(0, 0, 0)
            }
        );

        // ---------- RIGHT ARM ----------
        const rightArm = createLayeredPart(
            {
                width: 4,
                height: 12,
                depth: 4,
                texture,
                uv: RIGHT_ARM,
                position: new THREE.Vector3(-6, 12, 0),
                pivot: new THREE.Vector3(0, 0, 0)
            },
            {
                width: 4,
                height: 12,
                depth: 4,
                texture,
                uv: RIGHT_SLEEVE,
                position: new THREE.Vector3(-6, 12, 0),
                pivot: new THREE.Vector3(0, 0, 0)
            }
        );

        // ---------- LEFT ARM (mirror UV reuse) ----------
        const leftArm = createLayeredPart(
            {
                width: 4,
                height: 12,
                depth: 4,
                texture,
                uv: RIGHT_ARM,
                position: new THREE.Vector3(6, 12, 0),
                pivot: new THREE.Vector3(0, 0, 0)
            },
            {
                width: 4,
                height: 12,
                depth: 4,
                texture,
                uv: RIGHT_SLEEVE,
                position: new THREE.Vector3(6, 12, 0),
                pivot: new THREE.Vector3(0, 0, 0)
            }
        );

        // ---------- LEGS ----------
        const rightLeg = createLayeredPart(
            {
                width: 4,
                height: 12,
                depth: 4,
                texture,
                uv: RIGHT_LEG,
                position: new THREE.Vector3(2, 0, 0),
                pivot: new THREE.Vector3(0, 0, 0)
            },
            {
                width: 4,
                height: 12,
                depth: 4,
                texture,
                uv: RIGHT_PANTS,
                position: new THREE.Vector3(2, 0, 0),
                pivot: new THREE.Vector3(0, 0, 0)
            }
        );

        const leftLeg = createLayeredPart(
            {
                width: 4,
                height: 12,
                depth: 4,
                texture,
                uv: RIGHT_LEG,
                position: new THREE.Vector3(-2, 0, 0),
                pivot: new THREE.Vector3(0, 0, 0)
            },
            {
                width: 4,
                height: 12,
                depth: 4,
                texture,
                uv: RIGHT_PANTS,
                position: new THREE.Vector3(-2, 0, 0),
                pivot: new THREE.Vector3(0, 0, 0)
            }
        );

        // ---------- ROOT ----------
        this.root.add(
            head.base, head.overlay,
            body.base, body.overlay,
            rightArm.base, rightArm.overlay,
            leftArm.base, leftArm.overlay,
            rightLeg.base, rightLeg.overlay,
            leftLeg.base, leftLeg.overlay
        );

        this.head = head.base;
        this.headHat = head.overlay;

        this.body = body.base;
        this.jacket = body.overlay;

        this.rightArm = rightArm.base;
        this.rightSleeve = rightArm.overlay;

        this.leftArm = leftArm.base;
        this.leftSleeve = leftArm.overlay;

        this.rightLeg = rightLeg.base;
        this.rightPants = rightLeg.overlay;

        this.leftLeg = leftLeg.base;
        this.leftPants = leftLeg.overlay;
    }
}
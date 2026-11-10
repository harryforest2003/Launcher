import * as THREE from "three";
import type SkinEntity from "./SkinEntity";

export default class MinecraftRenderer {

    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public entities: SkinEntity[] = [];

    addEntity(entity: SkinEntity) {
        this.entities.push(entity);
        this.scene.add(entity.root);
    }

    constructor(canvas: HTMLCanvasElement) {

        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(
            35,
            canvas.clientWidth / canvas.clientHeight,
            0.1,
            1000
        );

        this.camera.position.set(0, 18, 38);

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false
        });

        this.renderer.setPixelRatio(window.devicePixelRatio);

        this.renderer.setSize(
            canvas.clientWidth,
            canvas.clientHeight,
            false
        );

        this.renderer.setClearColor(0x202020);

        const ambient = new THREE.AmbientLight(
            0xffffff,
            1.2
        );

        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(
            0xffffff,
            2
        );

        sun.position.set(15, 30, 25);

        this.scene.add(sun);

    }

    render() {

        this.renderer.render(
            this.scene,
            this.camera
        );

    }

    resize() {

        const canvas = this.renderer.domElement;

        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(
            width,
            height,
            false
        );

    }

    dispose() {

        this.renderer.dispose();

    }

}
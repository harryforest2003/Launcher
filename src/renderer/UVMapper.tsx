import * as THREE from "three";

/*
    Minecraft skins are 64x64.

    This helper converts pixel coordinates
    into UV coordinates for Three.js.
*/

export function uv(
    x: number,
    y: number,
    w: number,
    h: number
) {

    return [

        new THREE.Vector2(x / 64, 1 - y / 64),
        new THREE.Vector2((x + w) / 64, 1 - y / 64),
        new THREE.Vector2((x + w) / 64, 1 - (y + h) / 64),
        new THREE.Vector2(x / 64, 1 - (y + h) / 64)

    ];

}
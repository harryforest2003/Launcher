import * as THREE from "three";
// This file *defines* createCube/CubeOptions/PartOptions; importing them from
// itself made the module self-referential and unbuildable.

export interface LayeredPart {

    base: THREE.Group;

    overlay: THREE.Group;

}

export interface UVRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CubeUV {
    front: UVRect;
    back: UVRect;
    left: UVRect;
    right: UVRect;
    top: UVRect;
    bottom: UVRect;
}

export interface CubeOptions {

    width: number;
    height: number;
    depth: number;

    texture: THREE.Texture;

    uv: CubeUV;

    inflate?: number;

}

const SKIN_SIZE = 64;

function convertUV(rect: UVRect) {

    const u0 = rect.x / SKIN_SIZE;
    const v0 = 1 - (rect.y + rect.height) / SKIN_SIZE;

    const u1 = (rect.x + rect.width) / SKIN_SIZE;
    const v1 = 1 - rect.y / SKIN_SIZE;

    return [

        new THREE.Vector2(u0, v0),
        new THREE.Vector2(u1, v0),
        new THREE.Vector2(u1, v1),
        new THREE.Vector2(u0, v1)

    ];

}

function pushQuad(

    positions: number[],
    normals: number[],
    uvs: number[],
    indices: number[],

    verts: THREE.Vector3[],
    normal: THREE.Vector3,
    uv: THREE.Vector2[]

) {

    const start = positions.length / 3;

    for (let i = 0; i < 4; i++) {

        positions.push(
            verts[i].x,
            verts[i].y,
            verts[i].z
        );

        normals.push(
            normal.x,
            normal.y,
            normal.z
        );

        uvs.push(
            uv[i].x,
            uv[i].y
        );

    }

    indices.push(

        start,
        start + 1,
        start + 2,

        start,
        start + 2,
        start + 3

    );

}

export interface PartOptions extends CubeOptions {

    pivot: THREE.Vector3;

    position: THREE.Vector3;

}

export function createCube(options: CubeOptions) {

    const {

        width,
        height,
        depth,
        texture,
        uv,
        inflate = 0

    } = options;

    const hw = width / 2 + inflate;
    const hh = height / 2 + inflate;
    const hd = depth / 2 + inflate;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // ---------- FRONT ----------

    pushQuad(
        positions,
        normals,
        uvs,
        indices,
        [
            new THREE.Vector3(-hw, -hh, hd),
            new THREE.Vector3(hw, -hh, hd),
            new THREE.Vector3(hw, hh, hd),
            new THREE.Vector3(-hw, hh, hd)
        ],
        new THREE.Vector3(0, 0, 1),
        convertUV(uv.front)
    );

    // ---------- BACK ----------

    pushQuad(
        positions,
        normals,
        uvs,
        indices,
        [
            new THREE.Vector3(hw, -hh, -hd),
            new THREE.Vector3(-hw, -hh, -hd),
            new THREE.Vector3(-hw, hh, -hd),
            new THREE.Vector3(hw, hh, -hd)
        ],
        new THREE.Vector3(0, 0, -1),
        convertUV(uv.back)
    );

    // ---------- LEFT ----------

    pushQuad(
        positions,
        normals,
        uvs,
        indices,
        [
            new THREE.Vector3(-hw, -hh, -hd),
            new THREE.Vector3(-hw, -hh, hd),
            new THREE.Vector3(-hw, hh, hd),
            new THREE.Vector3(-hw, hh, -hd)
        ],
        new THREE.Vector3(-1, 0, 0),
        convertUV(uv.left)
    );

    // ---------- RIGHT ----------

    pushQuad(
        positions,
        normals,
        uvs,
        indices,
        [
            new THREE.Vector3(hw, -hh, hd),
            new THREE.Vector3(hw, -hh, -hd),
            new THREE.Vector3(hw, hh, -hd),
            new THREE.Vector3(hw, hh, hd)
        ],
        new THREE.Vector3(1, 0, 0),
        convertUV(uv.right)
    );

    // ---------- TOP ----------

    pushQuad(
        positions,
        normals,
        uvs,
        indices,
        [
            new THREE.Vector3(-hw, hh, hd),
            new THREE.Vector3(hw, hh, hd),
            new THREE.Vector3(hw, hh, -hd),
            new THREE.Vector3(-hw, hh, -hd)
        ],
        new THREE.Vector3(0, 1, 0),
        convertUV(uv.top)
    );

    // ---------- BOTTOM ----------

    pushQuad(
        positions,
        normals,
        uvs,
        indices,
        [
            new THREE.Vector3(-hw, -hh, -hd),
            new THREE.Vector3(hw, -hh, -hd),
            new THREE.Vector3(hw, -hh, hd),
            new THREE.Vector3(-hw, -hh, hd)
        ],
        new THREE.Vector3(0, -1, 0),
        convertUV(uv.bottom)
    );

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(

        "position",
        new THREE.Float32BufferAttribute(positions, 3)

    );

    geometry.setAttribute(

        "normal",
        new THREE.Float32BufferAttribute(normals, 3)

    );

    geometry.setAttribute(

        "uv",
        new THREE.Float32BufferAttribute(uvs, 2)

    );

    geometry.setIndex(indices);

    const material = new THREE.MeshStandardMaterial({

        map: texture,
        transparent: true,
        alphaTest: 0.1

    });

    return new THREE.Mesh(
        geometry,
        material
    );

}

export function createBodyPart(options: PartOptions) {

    const mesh = createCube(options);

    const part = createPart(
        mesh,
        options.pivot.x,
        options.pivot.y,
        options.pivot.z
    );

    part.position.copy(options.position);

    return part;

}

export function createLayeredPart(
    baseOptions: CubeOptions & PartOptions,
    overlayOptions: CubeOptions & PartOptions
): LayeredPart {

    const baseMesh = createCube(baseOptions);
    const overlayMesh = createCube({
        ...overlayOptions,
        inflate: overlayOptions.inflate ?? 0.5 // key trick
    });

    const base = new THREE.Group();
    const overlay = new THREE.Group();

    base.add(baseMesh);
    overlay.add(overlayMesh);

    overlay.position.copy(baseOptions.position);

    base.position.copy(baseOptions.position);

    return { base, overlay };
}

export function createPart(
    mesh: THREE.Mesh,
    pivotX = 0,
    pivotY = 0,
    pivotZ = 0
) {
    const group = new THREE.Group();

    mesh.position.set(-pivotX, -pivotY, -pivotZ);

    group.add(mesh);

    return group;
}
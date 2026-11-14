import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BuiltModel } from "../build";
import type { DisplayTable, DisplayTransform, ModelElement } from "../types";
import { Button } from "./shared";

type Props = {
  built: BuiltModel;
  display: DisplayTable;
};

type ViewMode = "free" | "gui" | "firstperson";

/** 4 game ticks, the time each glow frame shows for. */
const GLOW_FRAME_MS = 200;

const CORNERS = {
  south: (a: number[], b: number[]) => [[a[0], b[1], b[2]], [b[0], b[1], b[2]], [a[0], a[1], b[2]], [b[0], a[1], b[2]]],
  north: (a: number[], b: number[]) => [[b[0], b[1], a[2]], [a[0], b[1], a[2]], [b[0], a[1], a[2]], [a[0], a[1], a[2]]],
  east: (a: number[], b: number[]) => [[b[0], b[1], b[2]], [b[0], b[1], a[2]], [b[0], a[1], b[2]], [b[0], a[1], a[2]]],
  west: (a: number[], b: number[]) => [[a[0], b[1], a[2]], [a[0], b[1], b[2]], [a[0], a[1], a[2]], [a[0], a[1], b[2]]],
  up: (a: number[], b: number[]) => [[a[0], b[1], a[2]], [b[0], b[1], a[2]], [a[0], b[1], b[2]], [b[0], b[1], b[2]]],
  down: (a: number[], b: number[]) => [[a[0], a[1], b[2]], [b[0], a[1], b[2]], [a[0], a[1], a[2]], [b[0], a[1], a[2]]],
};

/** One mesh for all elements, laid out exactly as Minecraft reads the model file. */
function buildGeometry(elements: ModelElement[]) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const scratch = new THREE.Vector3();
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (const element of elements) {
    const angle = element.rotation ? (element.rotation.angle * Math.PI) / 180 : 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const ox = element.rotation?.origin[0] ?? 8;
    const oy = element.rotation?.origin[1] ?? 8;

    for (const [faceName, face] of Object.entries(element.faces)) {
      if (!face) continue;
      const corners = CORNERS[faceName as keyof typeof CORNERS](element.from, element.to);
      const start = positions.length / 3;
      const [u0, v0Face, u1, v1Face] = face.uv;
      const faceUvs = [
        [u0, v0Face],
        [u1, v0Face],
        [u0, v1Face],
        [u1, v1Face],
      ];

      const placed = corners.map(([x, y, z]) => {
        const dx = x - ox;
        const dy = y - oy;
        return [ox + dx * cos - dy * sin, oy + dx * sin + dy * cos, z];
      });

      v0.fromArray(placed[0]);
      v1.fromArray(placed[2]);
      v2.fromArray(placed[3]);
      normal.crossVectors(scratch.subVectors(v1, v0), v2.clone().sub(v0)).normalize();

      placed.forEach((point, index) => {
        positions.push(point[0], point[1], point[2]);
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(faceUvs[index][0] / 16, faceUvs[index][1] / 16);
      });

      indices.push(start, start + 2, start + 3, start, start + 3, start + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** Translate, rotate, scale, then move the model's centre to the origin, as the game does. */
function poseMatrix(transform: DisplayTransform | undefined) {
  const [tx, ty, tz] = transform?.translation ?? [0, 0, 0];
  const [rx, ry, rz] = transform?.rotation ?? [0, 0, 0];
  const [sx, sy, sz] = transform?.scale ?? [1, 1, 1];
  const toRadians = Math.PI / 180;

  const rotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rx * toRadians, ry * toRadians, rz * toRadians, "XYZ")
  );

  return new THREE.Matrix4()
    .compose(new THREE.Vector3(tx, ty, tz), rotation, new THREE.Vector3(sx, sy, sz))
    .multiply(new THREE.Matrix4().makeTranslation(-8, -8, -8));
}

export default function ItemPreview3D({ built, display }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ViewMode>("free");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.dataset.testid = "preview-3d";

    const scene = new THREE.Scene();

    const { raster, elements, glow } = built;

    const makeTexture = (rgba: ArrayLike<number>, width: number, height: number) => {
      const made = new THREE.DataTexture(new Uint8Array(rgba), width, height, THREE.RGBAFormat);
      made.magFilter = THREE.NearestFilter;
      made.minFilter = THREE.NearestFilter;
      made.colorSpace = THREE.SRGBColorSpace;
      made.needsUpdate = true;
      return made;
    };

    const texture = makeTexture(raster.rgba, raster.width, raster.height);
    const geometry = buildGeometry(elements.filter((element) => !element.light_emission));
    const material = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);

    // The glow ignores the lights, as light_emission does in game, and steps through
    // its strip at the game's pace of one frame every 4 ticks.
    const glowTexture = glow ? makeTexture(glow.strip, glow.frameWidth, glow.frameHeight * glow.frames) : null;
    const glowGeometry = glow ? buildGeometry(elements.filter((element) => element.light_emission)) : null;
    const glowMaterial = glowTexture ? new THREE.MeshBasicMaterial({ map: glowTexture, alphaTest: 0.5 }) : null;
    if (glowTexture && glow) glowTexture.repeat.set(1, 1 / glow.frames);
    const glowMesh = glowGeometry && glowMaterial ? new THREE.Mesh(glowGeometry, glowMaterial) : null;
    if (glowMesh) {
      glowMesh.matrixAutoUpdate = false;
      scene.add(glowMesh);
    }

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(6, 10, 14);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.7);
    fillLight.position.set(-8, -3, -12);
    scene.add(fillLight);

    const camera = new THREE.PerspectiveCamera(mode === "firstperson" ? 70 : 32, 1, 0.05, 400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = mode === "free";
    controls.enablePan = false;
    controls.minDistance = 6;
    controls.maxDistance = 120;

    if (mode === "free") {
      mesh.matrix.copy(poseMatrix(undefined));
      camera.position.set(14, 8, 34);
      controls.target.set(0, 0, 0);
      controls.autoRotate = true;
      controls.autoRotateSpeed = 1.6;
      controls.addEventListener("start", () => {
        controls.autoRotate = false;
      });
    } else if (mode === "gui") {
      mesh.matrix.copy(poseMatrix(display.gui));
      camera.position.set(0, 0, 30);
      camera.lookAt(0, 0, 0);
    } else {
      // Vanilla's right-hand position, in the 1/16 block units the model uses.
      const hand = new THREE.Matrix4().makeTranslation(0.56 * 16, -0.52 * 16, -0.72 * 16);
      mesh.matrix.copy(hand.multiply(poseMatrix(display.firstperson_righthand)));
      camera.position.set(0, 0, 0);
      camera.lookAt(0, 0, -1);
    }
    glowMesh?.matrix.copy(mesh.matrix);

    let frame = 0;
    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height);

      if (mode === "firstperson") {
        // The game's hand pose sits near the screen's edge, so it only fits at 16:9.
        const viewHeight = Math.min(height, (width * 9) / 16);
        const viewWidth = (viewHeight * 16) / 9;
        renderer.setViewport((width - viewWidth) / 2, (height - viewHeight) / 2, viewWidth, viewHeight);
        camera.aspect = 16 / 9;
      } else {
        camera.aspect = width / height;
      }
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const animate = () => {
      frame = requestAnimationFrame(animate);
      if (controls.enabled) controls.update();
      if (glowTexture && glow) {
        const step = Math.floor(performance.now() / GLOW_FRAME_MS) % glow.frames;
        glowTexture.offset.y = step / glow.frames;
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      glowGeometry?.dispose();
      glowMaterial?.dispose();
      glowTexture?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [built, display, mode]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <Button active={mode === "free"} onClick={() => setMode("free")}>Rotate</Button>
        <Button active={mode === "gui"} onClick={() => setMode("gui")}>Inventory</Button>
        <Button active={mode === "firstperson"} onClick={() => setMode("firstperson")}>In hand</Button>
      </div>
      <div
        ref={hostRef}
        style={{
          flex: 1,
          minHeight: 420,
          borderRadius: 10,
          overflow: "hidden",
          background: "radial-gradient(circle at 50% 40%, var(--color-accent-subtle) 0%, var(--color-surface-sunken) 75%)",
          cursor: mode === "free" ? "grab" : "default",
        }}
      />
    </div>
  );
}

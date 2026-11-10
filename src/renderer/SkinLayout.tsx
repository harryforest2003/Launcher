import type { CubeUV } from "./CubeBuilder";

/*
 * Minecraft Java Skin Layout (64x64)
 *
 * Coordinates are measured in pixels.
 * These are the base layer only.
 */

/* ---------------- HEAD ---------------- */

export const HEAD: CubeUV = {

    right:  { x: 0,  y: 8, width: 8, height: 8 },
    left:   { x: 16, y: 8, width: 8, height: 8 },
    top:    { x: 8,  y: 0, width: 8, height: 8 },
    bottom: { x: 16, y: 0, width: 8, height: 8 },
    front:  { x: 8,  y: 8, width: 8, height: 8 },
    back:   { x: 24, y: 8, width: 8, height: 8 }

};

export const HAT: CubeUV = {

    right:  { x: 32, y: 8, width: 8, height: 8 },
    left:   { x: 48, y: 8, width: 8, height: 8 },
    top:    { x: 40, y: 0, width: 8, height: 8 },
    bottom: { x: 48, y: 0, width: 8, height: 8 },
    front:  { x: 40, y: 8, width: 8, height: 8 },
    back:   { x: 56, y: 8, width: 8, height: 8 }

};

/* ---------------- BODY ---------------- */

export const BODY: CubeUV = {

    right:  { x: 16, y: 20, width: 4, height: 12 },
    left:   { x: 28, y: 20, width: 4, height: 12 },
    top:    { x: 20, y: 16, width: 8, height: 4 },
    bottom: { x: 28, y: 16, width: 8, height: 4 },
    front:  { x: 20, y: 20, width: 8, height: 12 },
    back:   { x: 32, y: 20, width: 8, height: 12 }

};

export const JACKET: CubeUV = {

    right:  { x: 16, y: 36, width: 4, height: 12 },
    left:   { x: 28, y: 36, width: 4, height: 12 },
    top:    { x: 20, y: 32, width: 8, height: 4 },
    bottom: { x: 28, y: 32, width: 8, height: 4 },
    front:  { x: 20, y: 36, width: 8, height: 12 },
    back:   { x: 32, y: 36, width: 8, height: 12 }

};

/* ---------------- RIGHT ARM (STEVE) ---------------- */

export const RIGHT_ARM: CubeUV = {

    right:  { x: 40, y: 20, width: 4, height: 12 },
    left:   { x: 52, y: 20, width: 4, height: 12 },
    top:    { x: 44, y: 16, width: 4, height: 4 },
    bottom: { x: 48, y: 16, width: 4, height: 4 },
    front:  { x: 44, y: 20, width: 4, height: 12 },
    back:   { x: 48, y: 20, width: 4, height: 12 }

};

export const RIGHT_SLEEVE: CubeUV = {

    right:  { x: 40, y: 36, width: 4, height: 12 },
    left:   { x: 52, y: 36, width: 4, height: 12 },
    top:    { x: 44, y: 32, width: 4, height: 4 },
    bottom: { x: 48, y: 32, width: 4, height: 4 },
    front:  { x: 44, y: 36, width: 4, height: 12 },
    back:   { x: 48, y: 36, width: 4, height: 12 }

};

/* ---------------- RIGHT LEG ---------------- */

export const RIGHT_LEG: CubeUV = {

    right:  { x: 0,  y: 20, width: 4, height: 12 },
    left:   { x: 12, y: 20, width: 4, height: 12 },
    top:    { x: 4,  y: 16, width: 4, height: 4 },
    bottom: { x: 8,  y: 16, width: 4, height: 4 },
    front:  { x: 4,  y: 20, width: 4, height: 12 },
    back:   { x: 8,  y: 20, width: 4, height: 12 }

};

export const RIGHT_PANTS: CubeUV = {

    right:  { x: 0,  y: 36, width: 4, height: 12 },
    left:   { x: 12, y: 36, width: 4, height: 12 },
    top:    { x: 4,  y: 32, width: 4, height: 4 },
    bottom: { x: 8,  y: 32, width: 4, height: 4 },
    front:  { x: 4,  y: 36, width: 4, height: 12 },
    back:   { x: 8,  y: 36, width: 4, height: 12 }

};
import type MinecraftRenderer from "./MinecraftRenderer";

export function startLoop(renderer: MinecraftRenderer) {

    let last = performance.now();

    function frame(time: number) {

        const delta = (time - last) / 1000;
        last = time;

        // ----------------------------
        // UPDATE ENTITIES
        // ----------------------------
        // SkinEntity.update() already advances its own AnimationController
        // and applies the result to the model, so the old three-step dance
        // over `controller` / `applyAnimation` (neither of which exists)
        // collapses to one call.
        for (const entity of renderer.entities) {
            entity.update(delta);
        }

        // ----------------------------
        // RENDER
        // ----------------------------
        renderer.render();

        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}
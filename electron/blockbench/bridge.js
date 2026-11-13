/*
 * Runs inside Blockbench's page once it has loaded. It opens each thing the launcher asks
 * to edit, one after another in this same window, and makes Save send the result back to
 * the launcher instead of downloading a file. It uses only Blockbench's public objects.
 */
(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let tries = 0; tries < 600 && !window.Blockbench?.setup_successful; tries += 1) {
    await pause(100);
  }

  // The launcher keeps this window hidden until this says what's being edited is open,
  // so the first thing seen is the editor. Anything that stops it opening still shows
  // the window, with whatever Blockbench has to say.
  const ready = () => window.unityLauncher.ready().catch(() => {});

  // Blockbench didn't start: the launcher starts another one.
  if (!window.Blockbench?.setup_successful) return window.unityLauncher.failed().catch(ready);

  /*
   * The side panels take these shares of the editor's width when something opens, and
   * keep their share when the window changes size, including after being dragged.
   */
  const LEFT_SHARE = 0.254;
  const RIGHT_SHARE = 0.29;
  let lastWidth = 0;

  const setPanelShares = (width) => {
    Interface.data.left_bar_width = Math.round(width * LEFT_SHARE);
    Interface.data.right_bar_width = Math.round(width * RIGHT_SHARE);
    // Widths saved for a single mode would win over these.
    Interface.data.modes = {};
    lastWidth = width;
    updateInterface();
  };

  // Keeps each panel's share when the width changes, including while it was hidden.
  const keepShares = () => {
    const width = innerWidth;
    if (!width || !lastWidth || width === lastWidth) return;

    const scale = width / lastWidth;
    for (const data of [Interface.data, ...Object.values(Interface.data.modes ?? {})]) {
      if (data.left_bar_width) data.left_bar_width = Math.round(data.left_bar_width * scale);
      if (data.right_bar_width) data.right_bar_width = Math.round(data.right_bar_width * scale);
    }
    lastWidth = width;
    updateInterface();
  };

  addEventListener("resize", keepShares);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") keepShares();
  });

  /*
   * Skins from before 2014 are 64x32, with no separate left arm or leg. Minecraft makes
   * them 64x64 by copying the right ones across, mirrored, and this does the same, so
   * they fit Blockbench's player model. Saving then gives a normal 64x64 skin.
   */
  const modernSkin = async (dataUrl) => {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });

    if (image.width !== 64 || image.height !== 32) return dataUrl;

    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);

    // Minecraft's own list: each area moves by (dx, dy) and flips left to right.
    const mirrored = [
      [4, 16, 16, 32, 4, 4], [8, 16, 16, 32, 4, 4], [0, 20, 24, 32, 4, 12], [4, 20, 16, 32, 4, 12],
      [8, 20, 8, 32, 4, 12], [12, 20, 16, 32, 4, 12], [44, 16, -8, 32, 4, 4], [48, 16, -8, 32, 4, 4],
      [40, 20, 0, 32, 4, 12], [44, 20, -8, 32, 4, 12], [48, 20, -16, 32, 4, 12], [52, 20, -8, 32, 4, 12],
    ];

    for (const [x, y, dx, dy, w, h] of mirrored) {
      ctx.save();
      ctx.translate(x + dx + w, y + dy);
      ctx.scale(-1, 1);
      ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
      ctx.restore();
    }

    return canvas.toDataURL("image/png");
  };

  // What's open now, as the launcher described it.
  let job = null;

  const collect = () => {
    if (job.kind === "skin") {
      return { image: Texture.all[0]?.getDataURL() ?? null };
    }

    return {
      model: Codecs.project.compile({ bitmaps: true }),
      textures: Texture.all.map((texture) => ({ name: texture.name, image: texture.getDataURL() })),
    };
  };

  // True once it's saved, so the launcher knows whether it's safe to close.
  const saveToLauncher = async () => {
    if (!job) return false;
    try {
      const message = await window.unityLauncher.save(collect());
      if (window.Project) Project.saved = true;
      Blockbench.showQuickMessage(message || "Saved to Unity Launcher", 2500);
      return true;
    } catch (err) {
      Blockbench.showMessageBox({
        title: "Couldn't save to Unity Launcher",
        message: String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""),
      });
      return false;
    }
  };

  // The launcher's own Save button.
  window.__unityLauncherSave = saveToLauncher;

  // Save, Save As and their shortcuts all go back to the launcher.
  for (const id of ["save_project", "save_project_as", "export_over"]) {
    if (window.BarItems?.[id]) BarItems[id].click = saveToLauncher;
  }

  /*
   * Done in the launcher: what's open is closed without asking, as the launcher has
   * already dealt with unsaved changes, and this window waits for the next thing.
   */
  let closed = null;

  // Closes everything open, carrying on past anything that won't close.
  const closeAll = async () => {
    let all = true;
    for (const project of [...(window.ModelProject?.all ?? [])]) {
      try {
        await project.close(true);
      } catch {
        all = false;
      }
    }
    return all;
  };

  window.__unityLauncherClose = async () => {
    try {
      return await closeAll();
    } finally {
      // Whatever happened, it's ready for the next thing.
      job = null;
      closed?.();
    }
  };

  const open = async () => {
    if (job.kind === "skin") {
      const content = await modernSkin(job.image);

      // The same steps as Blockbench's own "Minecraft Skin" dialog, with the answers filled in.
      Formats.skin.setup_dialog.onConfirm({
        model: job.slim ? "alex" : "steve",
        game_edition: "java_edition",
        resolution: 1,
        texture_source: "upload_texture",
        texture_file: { name: `${job.name}.png`, path: `${job.name}.png`, content },
        pose: false,
        layer_template: false,
      });
    } else {
      // Tried twice: once in a while Blockbench isn't quite ready for it.
      const before = window.Project;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await loadModelFile({ name: `${job.name}.bbmodel`, path: `${job.name}.bbmodel`, content: job.model });
        if (window.Project && window.Project !== before) break;
        await pause(300);
      }
      if (!window.Project || window.Project === before) throw new Error("Blockbench couldn't read the model file.");
    }

    if (window.Project) {
      Project.name = job.name;
      Project.saved = true;
    }

    // Its textures, so the model isn't first seen blank. Blockbench sets a texture's width
    // once its image has loaded, or its error if it couldn't.
    const loading = () => window.Texture?.all.some((texture) => !texture.width && !texture.error);
    for (let tries = 0; tries < 30 && loading(); tries += 1) {
      await pause(50);
    }
  };

  // One thing at a time: open it, show it, then wait for Done before taking the next.
  for (;;) {
    let next;
    try {
      next = await window.unityLauncher.job();
    } catch {
      await pause(1000);
      continue;
    }
    job = next;
    const waitForClose = new Promise((resolve) => (closed = resolve));

    try {
      // Anything left open from before (a close that didn't finish) goes first.
      if (window.ModelProject?.all.length) await closeAll();

      // The width the launcher gives it: hidden, it may not know its own yet.
      setPanelShares(job.width || innerWidth || 1200);

      await open();
    } catch (err) {
      Blockbench.showMessageBox({
        title: "Couldn't open this in Blockbench",
        message: String(err?.message ?? err),
      });
    } finally {
      // A moment for the editor to draw itself.
      await pause(50);
      ready();
    }

    await waitForClose;
  }
})();

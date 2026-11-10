/*
 * Runs inside Blockbench's page once it has loaded. It opens what the launcher asked
 * to edit, and makes Save send the result back to the launcher instead of downloading
 * a file. It uses only Blockbench's public objects, so Blockbench itself is unchanged.
 */
(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let tries = 0; tries < 600 && !window.Blockbench?.setup_successful; tries += 1) {
    await pause(100);
  }

  if (!window.Blockbench?.setup_successful) return;

  const job = await window.unityLauncher.job();
  if (!job) return;

  // The side panels' default share of the width, in every mode, from a layout picked in
  // the launcher. Panels can still be dragged; the next time it opens, it starts here.
  const LEFT_SHARE = 0.254;
  const RIGHT_SHARE = 0.29;

  Interface.data.left_bar_width = Math.round(innerWidth * LEFT_SHARE);
  Interface.data.right_bar_width = Math.round(innerWidth * RIGHT_SHARE);
  // Widths saved for a single mode would win over these.
  Interface.data.modes = {};
  updateInterface();

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
    loadModelFile({ name: `${job.name}.bbmodel`, path: `${job.name}.bbmodel`, content: job.model });
  }

  if (window.Project) {
    Project.name = job.name;
    Project.saved = true;
  }

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


})();

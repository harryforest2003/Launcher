import * as THREE from "three";

export default class SkinLoader {

    private static loader = new THREE.TextureLoader();

    private static cache = new Map<string, THREE.Texture>();

    static async load(url: string): Promise<THREE.Texture> {

        if (this.cache.has(url)) {

            return this.cache.get(url)!;

        }

        return new Promise((resolve, reject) => {

            this.loader.load(

                url,

                texture => {

                    texture.magFilter = THREE.NearestFilter;
                    texture.minFilter = THREE.NearestFilter;
                    texture.generateMipmaps = false;
                    texture.flipY = false;

                    this.cache.set(url, texture);

                    resolve(texture);

                },

                undefined,

                error => reject(error)

            );

        });

    }

    static clearCache() {

        this.cache.forEach(texture => texture.dispose());

        this.cache.clear();

    }

}
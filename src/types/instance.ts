export interface Instance {
    id: string;
    name: string;
    version: string;
    loader: string;
    loaderVersion: string;
    javaVersion: string;
    ram: number;
    icon?: string;
    path: string;
}
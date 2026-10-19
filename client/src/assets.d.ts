// build-client.ts loads these with esbuild's file loader: the import's value
// is the URL of the copied, hashed file.
declare module "*.png" {
  const url: string;
  export default url;
}
declare module "*.jpg" {
  const url: string;
  export default url;
}
declare module "*.jpeg" {
  const url: string;
  export default url;
}
declare module "*.gif" {
  const url: string;
  export default url;
}
declare module "*.svg" {
  const url: string;
  export default url;
}
declare module "*.webp" {
  const url: string;
  export default url;
}

declare module "*.css";

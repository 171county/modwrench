// site/build.mjs bundles a .log file as its text.
declare module "*.log" {
  const text: string;
  export default text;
}

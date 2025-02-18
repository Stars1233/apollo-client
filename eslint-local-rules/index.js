require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    // we need this to be nodenext in the tsconfig, because
    // @typescript-eslint/utils only seems to export ESM
    // in TypeScript's eyes, but it totally works
    module: "commonjs",
    moduleResolution: "node",
  },
});

module.exports = {
  "require-using-disposable": require("./require-using-disposable").rule,
  "require-disable-act-environment":
    require("./require-disable-act-environment").rule,
  "forbid-act-in-disabled-act-environment":
    require("./forbid-act-in-disabled-act-environment").rule,
};

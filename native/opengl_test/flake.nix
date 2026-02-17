{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };
  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        nativeBuildInputs = with pkgs; [
          libGL
          libGLU
          libglvnd
          mesa
          gcc
          libxcb
          libX11
          SDL2

        ];

      in {
        devShells.default = pkgs.mkShell {
          packages = nativeBuildInputs;
          env = {
            PKG_CONFIG_PATH =
              pkgs.lib.makeSearchPathOutput "dev" "lib/pkgconfig"
              (nativeBuildInputs);
            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath (nativeBuildInputs);
          };
        };
      });
}

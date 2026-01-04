{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        x11Deps = with pkgs; [ pkg-config xorg.libxcb xorg.xcbutilwm ];

        devDeps = [
          pkgs.libgbm
          pkgs.nodejs
          pkgs.python3
          pkgs.pkg-config
          pkgs.gnumake
          pkgs.gcc
          pkgs.electron
          pkgs.mesa
          pkgs.pango
          pkgs.expat
          pkgs.nspr
          pkgs.nss
          pkgs.cups
          pkgs.libdrm
          pkgs.dbus
          pkgs.glib
          pkgs.dbus-glib
          pkgs.atk
          pkgs.cairo
          pkgs.alsa-lib
          pkgs.at-spi2-atk
          pkgs.libxkbcommon
          pkgs.xorg.libXcomposite
          pkgs.xorg.libXrandr
          pkgs.xorg.libXext
          pkgs.xorg.libX11
          pkgs.xorg.libXfixes
          pkgs.xorg.libxcb
          pkgs.xorg.libXdamage
          pkgs.gtk2
          pkgs.libappindicator-gtk2
          pkgs.gtk3
          pkgs.libappindicator-gtk3
          pkgs.libGL
          pkgs.libva
          pkgs.pipewire
          pkgs.libglvnd
          pkgs.libudev0-shim
          pkgs.pkg-config
          pkgs.gcc
        ];

        electronDeps = with pkgs;
          [ vips nodejs (python311.withPackages (ps: [ ps.distutils ])) ]
          ++ x11Deps;

        makeAlt1lite = variant:
          pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "alt1lite";
            version = "0.0.1";
            src = ./.;
            inherit system;

            npmDeps = pkgs.fetchNpmDeps {
              src = "${finalAttrs.src}";
              packageLock = "${finalAttrs.src}/package-lock.json";
              hash = "sha256-ITTQvnTRkYejamomq67nrGup0dAuv7gbTXNTcMnt+Pk=";
            };

            env = {
              ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
              npm_config_nodedir = pkgs.electron.headers;
              SHARP_IGNORE_GLOBAL_LIBVIPS = "1";
              SHARP_LIBVIPS_VERSION = pkgs.vips.version;
              NIX_CFLAGS_COMPILE = toString [
                "-I${pkgs.glib.dev}/include/glib-2.0"
                "-I${pkgs.glib.out}/lib/glib-2.0/include"
                "-I${pkgs.vips.dev}/include"
                "-lvips"
              ];
              LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
                pkgs.vips
                pkgs.glib
                pkgs.libpng
                pkgs.libjpeg
                pkgs.libtiff
              ];
              doDist = false;
              NODE_ENV = "";
            };

            buildInputs = electronDeps ++ devDeps;

            nativeBuildInputs = [
              pkgs.npmHooks.npmConfigHook
              pkgs.npmHooks.npmBuildHook
              pkgs.npmHooks.npmInstallHook
              pkgs.nodejs
              pkgs.pkg-config
              pkgs.makeWrapper
              (pkgs.python311.withPackages (ps: [ ps.distutils ]))
            ];

            buildPhase = ''
              runHook preBuild

              export npm_config_ignore_scripts=true
              export npm_config_runtime=electron
              export npm_config_target=${pkgs.electron.version}
              export npm_config_disturl=https://electronjs.org/headers
              export npm_config_build_from_source=true

              npx --offline electron-rebuild \
                -f \
                -w alt1lite \
                -c.electronDist=${pkgs.electron}/libexec/electron \
                -c.electronVersion=${pkgs.electron.version}

              if [ "${variant}" == "debug" ]; then
                npm --offline run build -- --mode development
              else
                npm --offline run build -- --mode production
              fi

              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p "$out/share/lib/alt1lite" "$out/bin"
              mkdir -p "$out/share/lib/alt1lite/dist/tooltip/"
              ls -alh ./build
              cp -r ./dist "$out/share/lib/alt1lite"
              cp -r ./node_modules "$out/share/lib/alt1lite"
              cp -r ./build "$out/share/lib/alt1lite"
              ln -s "$out/share/lib/alt1lite/build" "$out/share/lib/build"
              cp -r ./bin "$out"
              cp -r ./config.json "$out/share/lib/alt1lite/dist/tooltip/"
              ln -s "$out/share/lib/alt1lite/dist/tooltip/config.json" "$out/share/lib/alt1lite/dist/config.json"
              # executable wrapper
              makeWrapper '${pkgs.electron}/bin/electron' "$out/bin/alt1lite" \
                --add-flags "--inspect=9228 $out/share/lib/alt1lite/dist/alt1lite.bundle.js"

              runHook postInstall
            '';
          });
      in {
        packages.default = makeAlt1lite "debug";
        apps.release = {
          type = "app";
          program = "${makeAlt1lite "release"}/bin/alt1lite";
        };

        apps.default = {
          type = "app";
          program = "${makeAlt1lite "debug"}/bin/alt1lite";
        };

        devShells.default = pkgs.mkShell {
          packages = devDeps ++ electronDeps ++ x11Deps;
          env = {
            ELECTRON_VERSION =
              pkgs.lib.versions.majorMinor pkgs.electron.version;
            PKG_CONFIG_PATH =
              pkgs.lib.makeSearchPathOutput "dev" "lib/pkgconfig"
              (electronDeps ++ x11Deps ++ devDeps);

            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath
              ([ pkgs.vips pkgs.glib pkgs.libpng pkgs.libjpeg pkgs.libtiff ]
                ++ devDeps);
            doDist = false;
            PYTHON = "${pkgs.python311}/bin/python3.11";
            CXXFLAGS = "-std=gnu++17";
            NODE_ENV = "development";
          };
        };

        formatter.${system} = pkgs.nixfmt;
      });
}

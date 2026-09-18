{
  description = "DeepSeek peak-pricing indicator for the dsh session UI";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { self, nixpkgs }:
    let
      # Раскладка пакета ровно как в репозитории: package.json и lib/ рядом.
      # dsh-client-modules ищет манифест вверх по дереву от импортированного
      # модуля, поэтому строка композиции указывает на lib/index.js, а браузеру
      # отдаётся exports["./client"] этого же манифеста.
      #
      # lib/ лежит в репозитории готовым (тест test/package-bundle.test.js
      # следит, чтобы он не разошёлся с src/), так что сборка — это копирование
      # трёх файлов: ни node, ни npm на этапе сборки не нужны.
      plugin =
        pkgs:
        pkgs.runCommand "deepseek-peaks" { } ''
          mkdir -p $out/lib
          cp ${./package.json} $out/package.json
          cp ${./lib/index.js} $out/lib/index.js
          cp ${./lib/client.js} $out/lib/client.js
        '';

      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      eachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = eachSystem (pkgs: rec {
        deepseek-peaks = plugin pkgs;
        default = deepseek-peaks;
      });

      # `nix flake check` прогоняет ту же сюиту, что и `npm test`, на исходниках
      # флейка. Исходники берутся через ${self}: гит-фильтр флейка уже исключил
      # tmp/ и node_modules, а lib/ в индексе, так что проверяются те же файлы,
      # что уехали в packages.
      checks = eachSystem (pkgs: {
        tests = pkgs.runCommand "deepseek-peaks-tests" {
          nativeBuildInputs = [ pkgs.nodejs ];
        } ''
          cp -r ${self} source
          cd source
          node --test test/*.test.js
          touch $out
        '';
      });
    };
}

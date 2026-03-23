{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = with pkgs; [
    nodejs_22
    (python3.withPackages (ps: with ps; [
      requests
    ]))
  ];
}

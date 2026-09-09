# Shared rock textures

Source: Poly Haven Rock Face 03, CC0, photography Dario Barresi and processing Rico Cilliers. Source attribution and original download checksums were recorded in showcase/REPORT.md during the earlier Blender study. These scans are not a geological survey of Siberia.

Source files retained in showcase: rock_face_03_diff_2k.jpg and rock_face_03_nor_gl_2k.jpg. Runtime files are 1024-square reductions: rock-albedo.jpg (sRGB) and rock-normal.png (linear OpenGL normal). No additional image-generation request or network download was made for this pass.

The pair is shared across the terrain material, with repeating mipmaps and triplanar projection; not one unique texture set per cliff. Estimated uncompressed RGBA8 GPU allocation including mipmaps: 10.67 MiB for the pair. Disk compression does not reduce that GPU allocation. Texture compression and hardware frame-time validation remain separate work.

Reproduction: tools/prepare-rock-textures.ps1, using Windows System.Drawing. Execution policy may require running its commands interactively; do not alter machine execution policy.

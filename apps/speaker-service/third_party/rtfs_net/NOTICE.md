RTFS-Net inference code, copyright (c) 2023 spkgyk, MIT (LICENSE beside this file).
Source: https://github.com/spkgyk/RTFS-Net
Pinned commit: 083348bc609275e05916ddc83ff64dd9ad95e9d0

Local changes: remove PyTorch Lightning serialization metadata/import and unused
training autoencoder; restrict the visual-model initializer to FRCNN; update the
DropPath import to timm.layers. Forward computations and state-dict keys are
preserved. SRU is the original MIT-licensed asappresearch implementation.
The upstream code acknowledges Asteroid; its MIT license must be retained where
applicable. Downloaded weights and their provenance are stored outside Git.

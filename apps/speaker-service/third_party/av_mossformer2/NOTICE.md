# AV-MossFormer2 provenance

Selected inference modules from modelscope/ClearerVoice-Studio at revision
`6b3774dc79c46ae8bed2a4fa5f706f0ac8c75c61` (Apache-2.0; see LICENSE).
Source: https://github.com/modelscope/ClearerVoice-Studio/tree/6b3774dc79c46ae8bed2a4fa5f706f0ac8c75c61/clearvoice/clearvoice/models/av_mossformer2_tse

The visual frontend retains its copyright 2020 Smeet Shah and MIT license
notice. Transformer modules retain their original author notices and derive
from the documented SpeechBrain/MossFormer components.

Local portability changes in av_mossformer2.py:
- Remove an unused torchaudio import.
- Create overlap-add indices on the input signal device instead of calling
  `.cuda()` unconditionally. No learned layers or parameters were changed.

Only required network modules and their pinned YAML configuration are included.
Face detectors, full toolkit wrappers, downloads, training scripts and examples
are excluded. Checkpoints are not bundled with this software.

Official checkpoint repository: https://huggingface.co/alibabasglab/AV_MossFormer2_TSE_16K
Pinned weight revision: `f168d2502161cf7ef5d55872d5f01f89e88e4c2e`.
The model card marks those weights Apache-2.0.

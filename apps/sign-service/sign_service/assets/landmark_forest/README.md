# Public-data alphabet forest

Training source: [Muhib-Mehdi/ASL-Recognition-System](https://github.com/Muhib-Mehdi/ASL-Recognition-System/tree/a66dd63ad597a023941f5ad90603aa267767d2ed), `model/keypoint_classifier/keypoint.csv`, MIT (see SOURCE_LICENSE).

Data SHA-256 and exact estimator/feature settings are in metadata.json. All 36,401 single-hand rows are used with horizontal-mirror augmentation. Acceptance videos and filename targets are not fitting inputs. This model was trained locally; it is not the repository's bundled neural checkpoint.

forest.npz contains numeric arrays only (roots, features, thresholds, children, class probabilities and class IDs); runtime uses allow_pickle=False and checks a pinned hash. Equivalent sklearn inference is verified separately. Reproduce with `python -m sign_service.train_landmarks` under the locked training dependency group. That command verifies the public CSV hash and accepts no videos or target labels.

The English repeat/word decoder is separate, based on the general frequency dictionary supplied by symspellpy; no project-specific phrases are stored in this model.

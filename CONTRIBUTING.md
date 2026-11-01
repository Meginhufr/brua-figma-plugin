# Contributing

This repository is a published copy of a directory in Brua's main repository, where the platform, its SDKs and tools are developed together, so that a change to the delivery contract reaches every SDK and the shared test fixtures in one commit. Each release is a snapshot of that directory, tagged here.

- **Issues are welcome here**, for bugs and requests about this package.
- **Pull requests are welcome too.** A merged change is ported into the main repository by a maintainer and appears here with the next release, with credit in the release notes. Commits can't land here directly.
- The tests are the ones the main repository runs: `fixtures/selection` holds the shared cases for the variant selection rule, and `fixtures/README.md` writes the rule out. A change to the rule starts with a fixture.

Brua is made by Meginhufr AS. Questions: hello@brua.dev.

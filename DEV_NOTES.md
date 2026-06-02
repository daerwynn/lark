# Local Nightingale Fork Notes

Goal:
Turn Nightingale from a party-karaoke app into a singing-practice/training app.
## Project identity

This fork is called **Lark**.

Lark is a fork of `rzru/nightingale`, but the goal is to move it toward a serious singing-practice and vocal-training app rather than primarily a party-karaoke app.

The original upstream project is still Nightingale, and upstream references should remain where they are technically or legally relevant. Do not blindly rename every occurrence of "Nightingale" until the codebase structure, build identifiers, app metadata, config paths, and license implications are understood.

## Local paths
- WSL repo: ~/github/lark
- Dev data folder: ~/larkdata
- Test library: ~/larkmusic
- Ultrastar library: ~/larkultrastar
- Do not use the Windows production Nightingale data folder.

Primary UX problems observed:
- Pitch/scoring display is too small.
- Singer cannot clearly see expected pitch vs actual pitch.
- App is not effective as a learning tool because it gives score/feedback but not enough correction guidance.
- Need large Rock Band-style vocal lane.
- Need phrase looping and practice mode.
- Need chart visibility/editability.
- Need better UltraStar import/export workflow if feasible.

Development rule:
Make small, targeted changes. First inspect existing data flow before adding new analysis systems.

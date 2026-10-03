// Import every job runner for its registerRunner(...) side effect. index.ts imports this once.
import './generate';
import './location_establishing';
import './location_angle';
import './character_refs';
import './character_sheets';
import './character_build';
import './reference_sheet';
import './shot_keyframe';
import './shot_video';
import './project_export';
import './character_voice';
import './dialogue_line';
import '../loras/import';
import '../loras/train';

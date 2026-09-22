import "server-only";

import ddMp02Json from "../../../data/learning/curriculum/definite-dozen/dd_mp_02.json";
import ddMp03Json from "../../../data/learning/curriculum/definite-dozen/dd_mp_03.json";
import ddMp04Json from "../../../data/learning/curriculum/definite-dozen/dd_mp_04.json";
import ddMp05Json from "../../../data/learning/curriculum/definite-dozen/dd_mp_05.json";
import ddMp06Json from "../../../data/learning/curriculum/definite-dozen/dd_mp_06.json";
import ddMp07Json from "../../../data/learning/curriculum/definite-dozen/dd_mp_07.json";
import ddMp08Json from "../../../data/learning/curriculum/definite-dozen/dd_mp_08.json";
import ddMp09Json from "../../../data/learning/curriculum/definite-dozen/dd_mp_09.json";
import ddMp10Json from "../../../data/learning/curriculum/definite-dozen/dd_mp_10.json";
import ddMp11Json from "../../../data/learning/curriculum/definite-dozen/dd_mp_11.json";
import ddMp12Json from "../../../data/learning/curriculum/definite-dozen/dd_mp_12.json";
import ddMp13Json from "../../../data/learning/curriculum/definite-dozen/dd_mp_13.json";
import {
  parseLearningMiniProgram,
  type LearningMiniProgram,
} from "./curriculum-types";

/**
 * Explicit registry of curated mini-programs.
 *
 * Add a future principle by importing its JSON and placing it in the right
 * collection. Do not read the immutable Docebo archive, and do not scan the filesystem.
 *
 * Runtime ids are archive ids. `dd_mp_02` and `dd_mp_02_st_001` are the values
 * progress will store. There is no second step-id scheme.
 * `sequence` is product order inside the collection, not Film Room order_index
 * and not the Docebo course index.
 */
const definiteDozenPrograms: LearningMiniProgram[] = [
  ddMp02Json,
  ddMp03Json,
  ddMp04Json,
  ddMp05Json,
  ddMp06Json,
  ddMp07Json,
  ddMp08Json,
  ddMp09Json,
  ddMp10Json,
  ddMp11Json,
  ddMp12Json,
  ddMp13Json,
].map((curriculum) => parseLearningMiniProgram(curriculum));

export const learningCurriculumRegistry: ReadonlyArray<{
  id: string;
  title: string;
  miniPrograms: readonly LearningMiniProgram[];
}> = [
  {
    id: "definite_dozen",
    title: "Definite Dozen",
    miniPrograms: definiteDozenPrograms,
  },
];

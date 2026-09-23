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
import CwMp01Json from "../../../data/learning/curriculum/championing-women/cw_mp_01.json";
import CwMp02Json from "../../../data/learning/curriculum/championing-women/cw_mp_02.json";
import CwMp03Json from "../../../data/learning/curriculum/championing-women/cw_mp_03.json";
import CwMp04Json from "../../../data/learning/curriculum/championing-women/cw_mp_04.json";
import CwMp05Json from "../../../data/learning/curriculum/championing-women/cw_mp_05.json";
import CwMp06Json from "../../../data/learning/curriculum/championing-women/cw_mp_06.json";
import CwMp07Json from "../../../data/learning/curriculum/championing-women/cw_mp_07.json";
import CwMp08Json from "../../../data/learning/curriculum/championing-women/cw_mp_08.json";
import CwMp09Json from "../../../data/learning/curriculum/championing-women/cw_mp_09.json";
import CwMp10Json from "../../../data/learning/curriculum/championing-women/cw_mp_10.json";
import CwMp11Json from "../../../data/learning/curriculum/championing-women/cw_mp_11.json";
import CwMp12Json from "../../../data/learning/curriculum/championing-women/cw_mp_12.json";
import CwMp13Json from "../../../data/learning/curriculum/championing-women/cw_mp_13.json";
import PotlMp01Json from "../../../data/learning/curriculum/power-of-team-leader/potl_mp_01.json";
import PotlMp02Json from "../../../data/learning/curriculum/power-of-team-leader/potl_mp_02.json";
import PotlMp03Json from "../../../data/learning/curriculum/power-of-team-leader/potl_mp_03.json";
import PotlMp04Json from "../../../data/learning/curriculum/power-of-team-leader/potl_mp_04.json";
import PotlMp05Json from "../../../data/learning/curriculum/power-of-team-leader/potl_mp_05.json";
import PotlMp06Json from "../../../data/learning/curriculum/power-of-team-leader/potl_mp_06.json";
import PotlMp07Json from "../../../data/learning/curriculum/power-of-team-leader/potl_mp_07.json";
import PotlMp08Json from "../../../data/learning/curriculum/power-of-team-leader/potl_mp_08.json";
import PotlMp09Json from "../../../data/learning/curriculum/power-of-team-leader/potl_mp_09.json";
import PotlMp10Json from "../../../data/learning/curriculum/power-of-team-leader/potl_mp_10.json";
import PotlMp11Json from "../../../data/learning/curriculum/power-of-team-leader/potl_mp_11.json";
import PotlMp12Json from "../../../data/learning/curriculum/power-of-team-leader/potl_mp_12.json";
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


const championingWomenPrograms: LearningMiniProgram[] = [
  CwMp01Json,
  CwMp02Json,
  CwMp03Json,
  CwMp04Json,
  CwMp05Json,
  CwMp06Json,
  CwMp07Json,
  CwMp08Json,
  CwMp09Json,
  CwMp10Json,
  CwMp11Json,
  CwMp12Json,
  CwMp13Json,
].map((curriculum) => parseLearningMiniProgram(curriculum));

const powerOfTeamLeaderPrograms: LearningMiniProgram[] = [
  PotlMp01Json,
  PotlMp02Json,
  PotlMp03Json,
  PotlMp04Json,
  PotlMp05Json,
  PotlMp06Json,
  PotlMp07Json,
  PotlMp08Json,
  PotlMp09Json,
  PotlMp10Json,
  PotlMp11Json,
  PotlMp12Json,
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
  {
    id: "championing_women",
    title: "Championing Women in Leadership",
    miniPrograms: championingWomenPrograms,
  },
  {
    id: "power_of_team_leader",
    title: "The Power of Team",
    miniPrograms: powerOfTeamLeaderPrograms,
  },
];

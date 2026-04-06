import { prisma } from "@/lib/prisma";
import type { ExperimentCandidate } from "@/lib/types";
import { getAnimalListView } from "@/lib/animals-read";

type ExperimentOverviewItem = {
  id: string;
  experimentCode: string;
  title: string;
  status: string;
  projectCode: string;
  assignments: Array<{
    id: string;
    animalId: string;
    status: string;
    startDate: string;
  }>;
};

export async function getExperimentOverviewView(): Promise<ExperimentOverviewItem[]> {
  const experiments = await prisma.experiment.findMany({
    orderBy: [{ status: "asc" }, { experimentCode: "asc" }],
    include: {
      project: {
        select: {
          projectCode: true,
        },
      },
      assignments: {
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
        include: {
          animal: {
            select: {
              animalId: true,
            },
          },
        },
      },
    },
  });

  return experiments.map((experiment) => ({
    id: experiment.id,
    experimentCode: experiment.experimentCode,
    title: experiment.title,
    status: experiment.status,
    projectCode: experiment.project.projectCode,
    assignments: experiment.assignments.map((assignment) => ({
      id: assignment.id,
      animalId: assignment.animal.animalId,
      status: assignment.status,
      startDate: assignment.startDate.toISOString(),
    })),
  }));
}

export async function getExperimentCandidateView(
  desiredNumber = 4,
  desiredSex: "male" | "female" | "either" = "female",
  minAgeDays = 28,
  maxAgeDays = 140,
  genotypeKeyword = "Cre",
): Promise<ExperimentCandidate[]> {
  const animals = await getAnimalListView();

  return animals
    .filter((animal) => animal.status === "colony_holding" || animal.status === "reserved")
    .filter((animal) => (desiredSex === "either" ? true : animal.sex === desiredSex))
    .filter((animal) => animal.ageDays >= minAgeDays && animal.ageDays <= maxAgeDays)
    .map((animal) => {
      const warnings = [...animal.warnings];
      const genotypeMatch = animal.genotypeSummary.toLowerCase().includes(genotypeKeyword.toLowerCase());
      const score =
        (animal.availableForExperiment ? 60 : 25) +
        (genotypeMatch ? 25 : 0) +
        (animal.sex === "female" ? 5 : 0) -
        warnings.length * 4;

      if (!genotypeMatch) {
        warnings.push("Genotype does not match the current experiment request");
      }

      return {
        animalId: animal.animalId,
        score,
        inclusionReason: animal.availableForExperiment
          ? "Eligible, genotype confirmed, and not in an active experiment"
          : "Included for review despite current blocker",
        warnings,
        cageLabel: animal.cageLabel,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, desiredNumber + 2);
}

import { db } from "@/lib/db";

// Enums - must match Prisma schema exactly
export const SubmissionStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  DECLINED: "DECLINED",
  NEEDS_REVISION: "NEEDS_REVISION",
} as const;

export const ActivityCategory = {
  WRITTEN_WORK: "WRITTEN_WORK",
  PERFORMANCE_TASK: "PERFORMANCE_TASK",
  QUARTERLY_ASSESSMENT: "QUARTERLY_ASSESSMENT",
} as const;

export type SubmissionStatusType = typeof SubmissionStatus[keyof typeof SubmissionStatus];
export type ActivityCategoryType = typeof ActivityCategory[keyof typeof ActivityCategory];

export interface GradeResult {
  writtenWorksScore: number;
  writtenWorksTotal: number;
  writtenWorksPercent: number;
  performanceTasksScore: number;
  performanceTasksTotal: number;
  performanceTasksPercent: number;
  quarterlyAssessmentScore: number;
  quarterlyAssessmentTotal: number;
  quarterlyAssessmentPercent: number;
  initialGrade: number;
  transmutedGrade: number;
}

export interface ComputedGrades {
  // Per-category stats
  ww: { earned: number; max: number; percent: number; count: number };
  pt: { earned: number; max: number; percent: number; count: number };
  qa: { earned: number; max: number; percent: number; count: number };
  // Grades
  currentGrade: number | null;  // APPROVED only
  tentativeGrade: number | null; // APPROVED + PENDING
  initialGrade: number | null;
  // Counts
  pendingCount: number;
  needsRevisionCount: number;
  approvedCount: number;
  // Eligibility
  isEligibleForTentative: boolean;
  isSynced: boolean;
}

export interface StudentGrade {
  studentId: string;
  studentName: string;
  lrn: string;
  section: string;
  grade: GradeResult;
  submissions: {
    activityId: string;
    activityTitle: string;
    category: string;
    rawScore: number;
    maxScore: number;
    percentScore: number;
    status: string;
  }[];
}

/**
 * Unified grade computation function for client-side use
 * Takes raw submission and activity data and computes all grades consistently
 */
export function computeGrades(
  submissions: Array<{
    activityId: string;
    rawScore: number;
    status: string;
    activity?: {
      id: string;
      category: string;
      maxScore: number;
    };
  }>,
  activities: Array<{
    id: string;
    category: string;
    maxScore: number;
    archived?: boolean;
  }>,
  gradingScheme?: {
    writtenWorksPercent: number;
    performanceTasksPercent: number;
    quarterlyAssessmentPercent: number;
  } | null
): ComputedGrades {
  // Filter out archived activities
  const activeActivities = activities.filter(a => !a.archived);
  
  // Create activity lookup
  const activityMap = new Map(activeActivities.map(a => [a.id, a]));
  
  // Categorize submissions
  const wwSubmissionsApproved: Array<{ earned: number; max: number }> = [];
  const ptSubmissionsApproved: Array<{ earned: number; max: number }> = [];
  const qaSubmissionsApproved: Array<{ earned: number; max: number }> = [];
  
  const wwSubmissionsWithPending: Array<{ earned: number; max: number }> = [];
  const ptSubmissionsWithPending: Array<{ earned: number; max: number }> = [];
  const qaSubmissionsWithPending: Array<{ earned: number; max: number }> = [];

  let pendingCount = 0;
  let needsRevisionCount = 0;
  let approvedCount = 0;

  for (const sub of submissions) {
    const activity = activityMap.get(sub.activityId) || sub.activity;
    if (!activity) continue;
    
    // Only count submissions for active (non-archived) activities
    const isActiveActivity = activeActivities.some(a => a.id === sub.activityId);
    if (!isActiveActivity) continue;

    const status = sub.status.toUpperCase();
    const earned = sub.rawScore;
    const max = activity.maxScore;
    
    const entry = { earned, max };
    
    // Count by status
    if (status === SubmissionStatus.APPROVED) {
      approvedCount++;
    } else if (status === SubmissionStatus.PENDING) {
      pendingCount++;
    } else if (status === SubmissionStatus.DECLINED || status === SubmissionStatus.NEEDS_REVISION) {
      needsRevisionCount++;
    }

    const category = activity.category.toUpperCase();
    
    // For APPROVED only (current grade)
    if (status === SubmissionStatus.APPROVED) {
      if (category === ActivityCategory.WRITTEN_WORK) {
        wwSubmissionsApproved.push(entry);
      } else if (category === ActivityCategory.PERFORMANCE_TASK) {
        ptSubmissionsApproved.push(entry);
      } else if (category === ActivityCategory.QUARTERLY_ASSESSMENT) {
        qaSubmissionsApproved.push(entry);
      }
    }
    
    // For APPROVED + PENDING (tentative grade)
    if (status === SubmissionStatus.APPROVED || status === SubmissionStatus.PENDING) {
      if (category === ActivityCategory.WRITTEN_WORK) {
        wwSubmissionsWithPending.push(entry);
      } else if (category === ActivityCategory.PERFORMANCE_TASK) {
        ptSubmissionsWithPending.push(entry);
      } else if (category === ActivityCategory.QUARTERLY_ASSESSMENT) {
        qaSubmissionsWithPending.push(entry);
      }
    }
  }

  // Calculate per-category stats (APPROVED only for display)
  const calcCategoryStats = (items: Array<{ earned: number; max: number }>) => {
    const earned = items.reduce((sum, i) => sum + i.earned, 0);
    const max = items.reduce((sum, i) => sum + i.max, 0);
    const percent = max > 0 ? (earned / max) * 100 : 0;
    return { earned, max, percent, count: items.length };
  };

  const ww = calcCategoryStats(wwSubmissionsApproved);
  const pt = calcCategoryStats(ptSubmissionsApproved);
  const qa = calcCategoryStats(qaSubmissionsApproved);

  // Calculate tentative eligibility (need at least 1 in each category with APPROVED or PENDING)
  const wwWithPending = calcCategoryStats(wwSubmissionsWithPending);
  const ptWithPending = calcCategoryStats(ptSubmissionsWithPending);
  const qaWithPending = calcCategoryStats(qaSubmissionsWithPending);

  const isEligibleForTentative = wwWithPending.count >= 1 && ptWithPending.count >= 1 && qaWithPending.count >= 1;

  // Calculate grades
  let currentGrade: number | null = null;
  let tentativeGrade: number | null = null;
  let initialGrade: number | null = null;

  const calcWeightedGrade = (
    wwStats: { percent: number; count: number },
    ptStats: { percent: number; count: number },
    qaStats: { percent: number; count: number },
    scheme: { writtenWorksPercent: number; performanceTasksPercent: number; quarterlyAssessmentPercent: number }
  ) => {
    const wwWeighted = (wwStats.percent * scheme.writtenWorksPercent) / 100;
    const ptWeighted = (ptStats.percent * scheme.performanceTasksPercent) / 100;
    const qaWeighted = (qaStats.percent * scheme.quarterlyAssessmentPercent) / 100;
    return wwWeighted + ptWeighted + qaWeighted;
  };

  // Current grade (APPROVED only) - needs all 3 categories
  const hasAllCategoriesApproved = ww.count >= 1 && pt.count >= 1 && qa.count >= 1;
  if (hasAllCategoriesApproved && gradingScheme) {
    initialGrade = calcWeightedGrade(ww, pt, qa, gradingScheme);
    currentGrade = transmuteGradeSimple(initialGrade);
  }

  // Tentative grade (APPROVED + PENDING)
  if (isEligibleForTentative && gradingScheme) {
    const tentativeInitial = calcWeightedGrade(wwWithPending, ptWithPending, qaWithPending, gradingScheme);
    tentativeGrade = transmuteGradeSimple(tentativeInitial);
  }

  // Sync: if no pending/needs revision, tentative = current
  const isSynced = isEligibleForTentative && pendingCount === 0 && needsRevisionCount === 0 && currentGrade !== null;
  if (isSynced) {
    tentativeGrade = currentGrade;
  }

  return {
    ww,
    pt,
    qa,
    currentGrade,
    tentativeGrade,
    initialGrade,
    pendingCount,
    needsRevisionCount,
    approvedCount,
    isEligibleForTentative,
    isSynced,
  };
}

/**
 * Simple transmutation: 0-100 -> 70-100 range
 */
export function transmuteGradeSimple(percentScore: number): number {
  // DepEd style: 0% -> 70, 100% -> 100
  // Linear mapping from 0-100 to 70-100
  return Math.round(70 + (percentScore / 100) * 30);
}

/**
 * Compute grade for a student in a class using only APPROVED submissions
 */
export async function computeStudentGrade(
  classId: string,
  studentId: string
): Promise<StudentGrade | null> {
  // Get class with grading scheme
  const cls = await db.class.findUnique({
    where: { id: classId },
    include: {
      gradingScheme: {
        include: { transmutationRules: { orderBy: { minPercent: "asc" } } },
      },
      activities: {
        where: { isActive: true },
        orderBy: [{ category: "asc" }, { order: "asc" }],
      },
      enrollments: {
        where: { studentId },
        include: {
          profile: true,
          student: { select: { name: true } },
        },
      },
    },
  });

  if (!cls || !cls.gradingScheme || cls.enrollments.length === 0) {
    return null;
  }

  const enrollment = cls.enrollments[0];

  // Get approved submissions for this student
  const submissions = await db.scoreSubmission.findMany({
    where: {
      studentId,
      status: "APPROVED",
      activity: { classId },
    },
    include: { activity: true },
  });

  // Group by category
  const writtenWorks = submissions.filter(
    (s) => s.activity.category === "WRITTEN_WORK"
  );
  const performanceTasks = submissions.filter(
    (s) => s.activity.category === "PERFORMANCE_TASK"
  );
  const quarterlyAssessments = submissions.filter(
    (s) => s.activity.category === "QUARTERLY_ASSESSMENT"
  );

  // Calculate totals per category
  const wwScore = writtenWorks.reduce((sum, s) => sum + s.rawScore, 0);
  const wwTotal = writtenWorks.reduce((sum, s) => sum + s.activity.maxScore, 0);
  const wwPercent = wwTotal > 0 ? (wwScore / wwTotal) * 100 : 0;

  const ptScore = performanceTasks.reduce((sum, s) => sum + s.rawScore, 0);
  const ptTotal = performanceTasks.reduce(
    (sum, s) => sum + s.activity.maxScore,
    0
  );
  const ptPercent = ptTotal > 0 ? (ptScore / ptTotal) * 100 : 0;

  const qaScore = quarterlyAssessments.reduce((sum, s) => sum + s.rawScore, 0);
  const qaTotal = quarterlyAssessments.reduce(
    (sum, s) => sum + s.activity.maxScore,
    0
  );
  const qaPercent = qaTotal > 0 ? (qaScore / qaTotal) * 100 : 0;

  // Calculate weighted scores
  const wwWeighted = (wwPercent * cls.gradingScheme.writtenWorksPercent) / 100;
  const ptWeighted =
    (ptPercent * cls.gradingScheme.performanceTasksPercent) / 100;
  const qaWeighted =
    (qaPercent * cls.gradingScheme.quarterlyAssessmentPercent) / 100;

  const initialGrade = wwWeighted + ptWeighted + qaWeighted;

  // Apply transmutation
  const transmutedGrade = transmuteGrade(
    initialGrade,
    cls.gradingScheme.transmutationRules
  );

  return {
    studentId,
    studentName: enrollment.profile.fullName,
    lrn: enrollment.profile.lrn,
    section: enrollment.profile.section || cls.section,
    grade: {
      writtenWorksScore: wwScore,
      writtenWorksTotal: wwTotal,
      writtenWorksPercent: Math.round(wwPercent * 100) / 100,
      performanceTasksScore: ptScore,
      performanceTasksTotal: ptTotal,
      performanceTasksPercent: Math.round(ptPercent * 100) / 100,
      quarterlyAssessmentScore: qaScore,
      quarterlyAssessmentTotal: qaTotal,
      quarterlyAssessmentPercent: Math.round(qaPercent * 100) / 100,
      initialGrade: Math.round(initialGrade * 100) / 100,
      transmutedGrade,
    },
    submissions: submissions.map((s) => ({
      activityId: s.activityId,
      activityTitle: s.activity.title,
      category: s.activity.category,
      rawScore: s.rawScore,
      maxScore: s.activity.maxScore,
      percentScore: Math.round((s.rawScore / s.activity.maxScore) * 100 * 100) / 100,
      status: s.status,
    })),
  };
}

/**
 * Transmute percentage score to final grade using DepEd-style table
 */
export function transmuteGrade(
  percentScore: number,
  rules: { minPercent: number; maxPercent: number; transmutedGrade: number }[]
): number {
  for (const rule of rules) {
    if (percentScore >= rule.minPercent && percentScore <= rule.maxPercent) {
      return rule.transmutedGrade;
    }
  }
  // Default to 70 if below range, 90 if above
  if (percentScore < rules[0]?.minPercent) return 70;
  return 90;
}

/**
 * Get all student grades for a class
 */
export async function computeClassGrades(classId: string): Promise<StudentGrade[]> {
  const enrollments = await db.enrollment.findMany({
    where: { classId, isActive: true },
    select: { studentId: true },
  });

  const grades: StudentGrade[] = [];

  for (const enrollment of enrollments) {
    const grade = await computeStudentGrade(classId, enrollment.studentId);
    if (grade) grades.push(grade);
  }

  return grades.sort((a, b) => a.studentName.localeCompare(b.studentName));
}

/**
 * Get at-risk students (grade below 75 or missing many submissions)
 */
export async function getAtRiskStudents(classId: string): Promise<{
  studentId: string;
  studentName: string;
  currentGrade: number;
  missingSubmissions: number;
}[]> {
  const cls = await db.class.findUnique({
    where: { id: classId },
    include: {
      activities: { where: { isActive: true } },
      enrollments: {
        include: { profile: true },
      },
    },
  });

  if (!cls) return [];

  const atRiskStudents: {
    studentId: string;
    studentName: string;
    currentGrade: number;
    missingSubmissions: number;
  }[] = [];

  for (const enrollment of cls.enrollments) {
    const grade = await computeStudentGrade(classId, enrollment.studentId);
    if (!grade) continue;

    const totalActivities = cls.activities.length;
    const submittedCount = grade.submissions.length;
    const missingCount = totalActivities - submittedCount;

    if (grade.grade.transmutedGrade < 75 || missingCount > totalActivities * 0.3) {
      atRiskStudents.push({
        studentId: enrollment.studentId,
        studentName: enrollment.profile.fullName,
        currentGrade: grade.grade.transmutedGrade,
        missingSubmissions: missingCount,
      });
    }
  }

  return atRiskStudents;
}

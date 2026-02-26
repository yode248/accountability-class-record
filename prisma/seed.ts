import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Create teacher account
  const teacherPassword = await bcrypt.hash("teacher123", 10);
  const teacher = await prisma.user.upsert({
    where: { email: "teacher@demo.com" },
    update: {},
    create: {
      email: "teacher@demo.com",
      name: "Ms. Maria Santos",
      password: teacherPassword,
      role: "TEACHER",
    },
  });
  console.log("✅ Created teacher:", teacher.email);

  // Create student accounts
  const studentPassword = await bcrypt.hash("student123", 10);
  const students = [
    { name: "Juan Dela Cruz", lrn: "123456789012", sex: "M" },
    { name: "Maria Clara", lrn: "123456789013", sex: "F" },
    { name: "Jose Rizal", lrn: "123456789014", sex: "M" },
    { name: "Andres Bonifacio", lrn: "123456789015", sex: "M" },
    { name: "Gabriela Silang", lrn: "123456789016", sex: "F" },
  ];

  const createdStudents = [];
  for (const student of students) {
    const user = await prisma.user.upsert({
      where: { email: `${student.lrn}@demo.com` },
      update: {},
      create: {
        email: `${student.lrn}@demo.com`,
        name: student.name,
        password: studentPassword,
        role: "STUDENT",
        studentProfile: {
          create: {
            fullName: student.name,
            lrn: student.lrn,
            sex: student.sex,
          },
        },
      },
      include: { studentProfile: true },
    });
    createdStudents.push(user);
    console.log("✅ Created student:", student.name);
  }

  // Create demo class
  const demoClass = await prisma.class.upsert({
    where: { code: "DEMO1234" },
    update: {},
    create: {
      name: "Mathematics 10 - Rizal",
      subject: "Mathematics",
      section: "Rizal",
      schoolYear: "2024-2025",
      quarter: 1,
      code: "DEMO1234",
      ownerId: teacher.id,
      gradingScheme: {
        create: {
          writtenWorksPercent: 30,
          performanceTasksPercent: 50,
          quarterlyAssessmentPercent: 20,
          transmutationRules: {
            createMany: {
              data: [
                { minPercent: 0, maxPercent: 4.99, transmutedGrade: 70 },
                { minPercent: 5, maxPercent: 9.99, transmutedGrade: 71 },
                { minPercent: 10, maxPercent: 14.99, transmutedGrade: 72 },
                { minPercent: 15, maxPercent: 19.99, transmutedGrade: 73 },
                { minPercent: 20, maxPercent: 24.99, transmutedGrade: 74 },
                { minPercent: 25, maxPercent: 29.99, transmutedGrade: 75 },
                { minPercent: 30, maxPercent: 34.99, transmutedGrade: 76 },
                { minPercent: 35, maxPercent: 39.99, transmutedGrade: 77 },
                { minPercent: 40, maxPercent: 44.99, transmutedGrade: 78 },
                { minPercent: 45, maxPercent: 49.99, transmutedGrade: 79 },
                { minPercent: 50, maxPercent: 54.99, transmutedGrade: 80 },
                { minPercent: 55, maxPercent: 59.99, transmutedGrade: 81 },
                { minPercent: 60, maxPercent: 64.99, transmutedGrade: 82 },
                { minPercent: 65, maxPercent: 69.99, transmutedGrade: 83 },
                { minPercent: 70, maxPercent: 74.99, transmutedGrade: 84 },
                { minPercent: 75, maxPercent: 79.99, transmutedGrade: 85 },
                { minPercent: 80, maxPercent: 84.99, transmutedGrade: 86 },
                { minPercent: 85, maxPercent: 89.99, transmutedGrade: 87 },
                { minPercent: 90, maxPercent: 94.99, transmutedGrade: 88 },
                { minPercent: 95, maxPercent: 100, transmutedGrade: 90 },
              ],
            },
          },
        },
      },
    },
    include: { gradingScheme: true },
  });
  console.log("✅ Created demo class:", demoClass.name, "- Code:", demoClass.code);

  // Enroll students
  for (const student of createdStudents) {
    if (student.studentProfile) {
      await prisma.enrollment.upsert({
        where: {
          classId_studentId: {
            classId: demoClass.id,
            studentId: student.id,
          },
        },
        update: {},
        create: {
          classId: demoClass.id,
          studentId: student.id,
          profileId: student.studentProfile.id,
        },
      });
    }
  }
  console.log("✅ Enrolled", createdStudents.length, "students");

  // Create activities
  const activities = [
    { category: "WRITTEN_WORK", title: "Quiz 1: Quadratic Equations", maxScore: 20 },
    { category: "WRITTEN_WORK", title: "Quiz 2: Polynomials", maxScore: 20 },
    { category: "WRITTEN_WORK", title: "Unit Test 1", maxScore: 50 },
    { category: "PERFORMANCE_TASK", title: "Math Project: Real-life Applications", maxScore: 100 },
    { category: "PERFORMANCE_TASK", title: "Group Activity: Problem Solving", maxScore: 50 },
    { category: "QUARTERLY_ASSESSMENT", title: "First Quarter Exam", maxScore: 100 },
  ];

  const createdActivities = [];
  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];
    const created = await prisma.activity.create({
      data: {
        classId: demoClass.id,
        category: activity.category as "WRITTEN_WORK" | "PERFORMANCE_TASK" | "QUARTERLY_ASSESSMENT",
        title: activity.title,
        maxScore: activity.maxScore,
        description: `Description for ${activity.title}`,
        instructions: `Instructions for ${activity.title}`,
        order: i + 1,
      },
    });
    createdActivities.push(created);
  }
  console.log("✅ Created", createdActivities.length, "activities");

  // Create sample submissions for some students
  const submissions = [
    { studentIndex: 0, activityIndex: 0, score: 18, status: "APPROVED" },
    { studentIndex: 0, activityIndex: 1, score: 15, status: "APPROVED" },
    { studentIndex: 0, activityIndex: 2, score: 42, status: "APPROVED" },
    { studentIndex: 0, activityIndex: 3, score: 85, status: "APPROVED" },
    { studentIndex: 1, activityIndex: 0, score: 20, status: "APPROVED" },
    { studentIndex: 1, activityIndex: 1, score: 18, status: "APPROVED" },
    { studentIndex: 1, activityIndex: 2, score: 45, status: "APPROVED" },
    { studentIndex: 1, activityIndex: 3, score: 92, status: "APPROVED" },
    { studentIndex: 2, activityIndex: 0, score: 16, status: "APPROVED" },
    { studentIndex: 2, activityIndex: 1, score: 14, status: "PENDING" },
    { studentIndex: 3, activityIndex: 0, score: 12, status: "NEEDS_REVISION" },
    { studentIndex: 4, activityIndex: 0, score: 19, status: "APPROVED" },
    { studentIndex: 4, activityIndex: 1, score: 17, status: "APPROVED" },
  ];

  for (const sub of submissions) {
    await prisma.scoreSubmission.create({
      data: {
        activityId: createdActivities[sub.activityIndex].id,
        studentId: createdStudents[sub.studentIndex].id,
        rawScore: sub.score,
        status: sub.status as "PENDING" | "APPROVED" | "DECLINED" | "NEEDS_REVISION",
        submittedAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
        reviewedAt: sub.status === "APPROVED" ? new Date() : null,
        reviewedBy: sub.status === "APPROVED" ? teacher.id : null,
      },
    });
  }
  console.log("✅ Created sample submissions");

  // Create attendance session
  const attendanceSession = await prisma.attendanceSession.create({
    data: {
      classId: demoClass.id,
      date: new Date(),
      title: "Week 1 Attendance",
      lateThresholdMinutes: 15,
    },
  });

  // Create attendance submissions
  const attendanceStatuses = ["PRESENT", "PRESENT", "LATE", "PRESENT", "ABSENT"];
  for (let i = 0; i < createdStudents.length; i++) {
    await prisma.attendanceSubmission.create({
      data: {
        sessionId: attendanceSession.id,
        studentId: createdStudents[i].id,
        status: attendanceStatuses[i] as "PRESENT" | "LATE" | "ABSENT",
        submissionStatus: "PENDING",
        checkedInAt: new Date(),
      },
    });
  }
  console.log("✅ Created attendance session and submissions");

  console.log("\n🎉 Seeding completed!");
  console.log("\n📋 Demo Accounts:");
  console.log("  Teacher: teacher@demo.com / teacher123");
  console.log("  Student: 123456789012@demo.com / student123");
  console.log("  Class Code: DEMO1234");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

-- Accountability Class Record - Safe Database Schema for Supabase/PostgreSQL
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/aadzmksnjwkzazoezqys/sql
-- This script uses IF NOT EXISTS to handle existing objects

-- Drop existing enums first (they may have been created before)
DO $$ BEGIN
    DROP TYPE IF EXISTS "UserRole" CASCADE;
    DROP TYPE IF EXISTS "NotificationType" CASCADE;
    DROP TYPE IF EXISTS "GradingPeriodStatus" CASCADE;
    DROP TYPE IF EXISTS "ActivityCategory" CASCADE;
    DROP TYPE IF EXISTS "SubmissionStatus" CASCADE;
    DROP TYPE IF EXISTS "AttendanceStatus" CASCADE;
END $$;

-- Create enums
CREATE TYPE "UserRole" AS ENUM ('TEACHER', 'STUDENT');
CREATE TYPE "NotificationType" AS ENUM ('REMINDER_MISSING_SUBMISSION', 'REMINDER_REVISION', 'GENERAL');
CREATE TYPE "GradingPeriodStatus" AS ENUM ('OPEN', 'COMPLETED');
CREATE TYPE "ActivityCategory" AS ENUM ('WRITTEN_WORK', 'PERFORMANCE_TASK', 'QUARTERLY_ASSESSMENT');
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'NEEDS_REVISION');
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT');

-- Drop existing tables (in reverse dependency order)
DROP TABLE IF EXISTS "SyncQueue" CASCADE;
DROP TABLE IF EXISTS "Notification" CASCADE;
DROP TABLE IF EXISTS "OTP" CASCADE;
DROP TABLE IF EXISTS "AuditLog" CASCADE;
DROP TABLE IF EXISTS "AttendanceSubmission" CASCADE;
DROP TABLE IF EXISTS "AttendanceSession" CASCADE;
DROP TABLE IF EXISTS "ScoreSubmission" CASCADE;
DROP TABLE IF EXISTS "Activity" CASCADE;
DROP TABLE IF EXISTS "Enrollment" CASCADE;
DROP TABLE IF EXISTS "TransmutationRule" CASCADE;
DROP TABLE IF EXISTS "GradingScheme" CASCADE;
DROP TABLE IF EXISTS "Class" CASCADE;
DROP TABLE IF EXISTS "StudentProfile" CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;

-- User table
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- Student Profile table
CREATE TABLE "StudentProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "lrn" TEXT NOT NULL,
    "sex" TEXT,
    "section" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id")
);

-- Class table
CREATE TABLE "Class" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "quarter" INTEGER NOT NULL DEFAULT 1,
    "code" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "qrToken" TEXT,
    "linkedFromClassId" TEXT,
    "gradingPeriodStatus" "GradingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "gradingPeriodCompletedAt" TIMESTAMP(3),
    "gradingPeriodCompletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- Grading Scheme table
CREATE TABLE "GradingScheme" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "writtenWorksPercent" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "performanceTasksPercent" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "quarterlyAssessmentPercent" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GradingScheme_pkey" PRIMARY KEY ("id")
);

-- Transmutation Rule table
CREATE TABLE "TransmutationRule" (
    "id" TEXT NOT NULL,
    "gradingSchemeId" TEXT NOT NULL,
    "minPercent" DOUBLE PRECISION NOT NULL,
    "maxPercent" DOUBLE PRECISION NOT NULL,
    "transmutedGrade" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransmutationRule_pkey" PRIMARY KEY ("id")
);

-- Enrollment table
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- Activity table
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "category" "ActivityCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3),
    "instructions" TEXT,
    "requiresEvidence" BOOLEAN NOT NULL DEFAULT false,
    "evidenceTypes" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "archiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- Score Submission table
CREATE TABLE "ScoreSubmission" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "rawScore" DOUBLE PRECISION NOT NULL,
    "evidenceUrl" TEXT,
    "evidenceType" TEXT,
    "notes" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "teacherFeedback" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScoreSubmission_pkey" PRIMARY KEY ("id")
);

-- Attendance Session table
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "lateThresholdMinutes" INTEGER NOT NULL DEFAULT 15,
    "qrToken" TEXT,
    "qrExpiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- Attendance Submission table
CREATE TABLE "AttendanceSubmission" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "proofUrl" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "notes" TEXT,
    "submissionStatus" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "teacherFeedback" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceSubmission_pkey" PRIMARY KEY ("id")
);

-- Audit Log table
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scoreSubmissionId" TEXT,
    "attendanceSubmissionId" TEXT,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- OTP table
CREATE TABLE "OTP" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    CONSTRAINT "OTP_pkey" PRIMARY KEY ("id")
);

-- Notification table
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "classId" TEXT,
    "activityId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- Sync Queue table
CREATE TABLE "SyncQueue" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "synced" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncQueue_pkey" PRIMARY KEY ("id")
);

-- Create unique indexes
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "StudentProfile_userId_key" ON "StudentProfile"("userId");
CREATE UNIQUE INDEX "StudentProfile_lrn_key" ON "StudentProfile"("lrn");
CREATE UNIQUE INDEX "Class_code_key" ON "Class"("code");
CREATE UNIQUE INDEX "GradingScheme_classId_key" ON "GradingScheme"("classId");
CREATE UNIQUE INDEX "Enrollment_classId_studentId_key" ON "Enrollment"("classId", "studentId");
CREATE UNIQUE INDEX "ScoreSubmission_activityId_studentId_key" ON "ScoreSubmission"("activityId", "studentId");
CREATE UNIQUE INDEX "AttendanceSubmission_sessionId_studentId_key" ON "AttendanceSubmission"("sessionId", "studentId");

-- Create regular indexes for performance
CREATE INDEX "TransmutationRule_gradingSchemeId_idx" ON "TransmutationRule"("gradingSchemeId");
CREATE INDEX "Activity_classId_archived_idx" ON "Activity"("classId", "archived");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "SyncQueue_userId_synced_idx" ON "SyncQueue"("userId", "synced");
CREATE INDEX "Notification_toUserId_isRead_idx" ON "Notification"("toUserId", "isRead");
CREATE INDEX "Notification_toUserId_createdAt_idx" ON "Notification"("toUserId", "createdAt");

-- Add foreign key constraints
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Class" ADD CONSTRAINT "Class_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Class" ADD CONSTRAINT "Class_linkedFromClassId_fkey" FOREIGN KEY ("linkedFromClassId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GradingScheme" ADD CONSTRAINT "GradingScheme_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransmutationRule" ADD CONSTRAINT "TransmutationRule_gradingSchemeId_fkey" FOREIGN KEY ("gradingSchemeId") REFERENCES "GradingScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoreSubmission" ADD CONSTRAINT "ScoreSubmission_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoreSubmission" ADD CONSTRAINT "ScoreSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceSubmission" ADD CONSTRAINT "AttendanceSubmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceSubmission" ADD CONSTRAINT "AttendanceSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_scoreSubmissionId_fkey" FOREIGN KEY ("scoreSubmissionId") REFERENCES "ScoreSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_attendanceSubmissionId_fkey" FOREIGN KEY ("attendanceSubmissionId") REFERENCES "AttendanceSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OTP" ADD CONSTRAINT "OTP_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Done! Database schema created successfully.

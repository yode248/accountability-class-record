"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, Users, ClipboardCheck, CheckCircle, XCircle, Clock,
  Plus, QrCode, Download, Settings, LogOut, User, ChevronRight,
  AlertTriangle, FileText, Calendar, Award, TrendingUp, Eye,
  Edit, Trash2, Send, RefreshCw, Menu, X, Home, Bell, BarChart3,
  AlertCircle, ListChecks, Camera, Scan, Wifi, WifiOff, Printer,
  MoreVertical, Archive, ArchiveRestore, Save, Copy
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format } from "date-fns";

// Types
interface Activity {
  id: string;
  category: "WRITTEN_WORK" | "PERFORMANCE_TASK" | "QUARTERLY_ASSESSMENT";
  title: string;
  description?: string;
  maxScore: number;
  dueDate?: string;
  instructions?: string;
  requiresEvidence: boolean;
  order: number;
  archived?: boolean;
  archivedAt?: string;
  archiveReason?: string;
  class?: { name: string };
}

interface Submission {
  id: string;
  activityId: string;
  activity: Activity;
  rawScore: number;
  evidenceUrl?: string;
  notes?: string;
  status: "PENDING" | "APPROVED" | "DECLINED" | "NEEDS_REVISION";
  teacherFeedback?: string;
  submittedAt: string;
  student?: {
    id: string;
    name?: string;
    studentProfile?: { fullName: string; lrn: string };
  };
}

interface AtRiskStudent {
  studentId: string;
  studentName: string;
  currentGrade: number;
  missingSubmissions: number;
}

interface ClassData {
  id: string;
  name: string;
  subject: string;
  section: string;
  schoolYear: string;
  quarter: number; // 1-4: Q1, Q2, Q3, Q4
  code: string;
  gradingScheme?: {
    writtenWorksPercent: number;
    performanceTasksPercent: number;
    quarterlyAssessmentPercent: number;
  };
  activities?: Activity[];
  enrollments?: Array<{
    id: string;
    studentId: string;
    profile: { fullName: string; lrn: string };
  }>;
  attendanceSessions?: Array<{
    id: string;
    date: string;
    title?: string;
    qrToken?: string;
    qrExpiresAt?: string;
  }>;
  gradingPeriodStatus?: "OPEN" | "COMPLETED";
  gradingPeriodCompletedAt?: string;
  gradingPeriodCompletedBy?: string;
  linkedFrom?: { id: string; name: string; subject: string; quarter?: number };
  linkedTo?: Array<{ id: string; name: string; subject: string; quarter?: number }>;
}

// API Functions
const api = {
  get: async (url: string) => {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error("Failed to fetch");
    return res.json();
  },
  post: async (url: string, data: unknown) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to create");
    }
    return res.json();
  },
  put: async (url: string, data: unknown) => {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to update");
    }
    return res.json();
  },
  delete: async (url: string) => {
    const res = await fetch(url, { method: "DELETE", credentials: 'include' });
    if (!res.ok) throw new Error("Failed to delete");
    return res.json();
  },
};

// Offline Indicator Component
function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? navigator.onLine : true);
  const [pendingSync, setPendingSync] = useState(0);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    // Set initial state
    updateOnlineStatus();
    
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    // Check pending items in IndexedDB
    if ("indexedDB" in window) {
      const request = indexedDB.open("ClassRecordOffline", 1);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (db.objectStoreNames.contains("pending")) {
          const tx = db.transaction("pending", "readonly");
          const store = tx.objectStore("pending");
          const countReq = store.count();
          countReq.onsuccess = () => setPendingSync(countReq.result);
        }
      };
    }

    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  if (isOnline && pendingSync === 0) return null;

  return (
    <div className={`fixed bottom-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full shadow-lg ${
      isOnline ? "bg-amber-500" : "bg-red-500"
    } text-white text-sm flex items-center gap-2`}>
      {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
      {isOnline ? `Syncing ${pendingSync} items...` : "You are offline. Changes will sync when online."}
    </div>
  );
}

// QR Scanner Component
function QRScanner({ onScan, onClose }: { onScan: (token: string) => void; onClose: () => void }) {
  const [manualCode, setManualCode] = useState("");

  return (
    <div className="space-y-4">
      <div className="bg-gray-100 rounded-lg p-8 text-center">
        <Camera className="w-12 h-12 mx-auto mb-2 text-gray-400" />
        <p className="text-sm text-gray-500">Camera scanning would be enabled here</p>
        <p className="text-xs text-gray-400 mt-1">(Requires HTTPS for camera access)</p>
      </div>
      <div className="space-y-2">
        <Label>Or enter code manually:</Label>
        <Input
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value.toUpperCase())}
          placeholder="Enter attendance code"
          className="text-center tracking-widest text-lg"
          maxLength={10}
        />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
        <Button 
          onClick={() => { onScan(manualCode); onClose(); }}
          className="flex-1 bg-teal-600"
          disabled={manualCode.length < 4}
        >
          Submit
        </Button>
      </div>
    </div>
  );
}

// QR Code Display Component
function QRCodeDisplay({ token, expiresAt }: { token: string; expiresAt?: string }) {
  const [timeLeft, setTimeLeft] = useState<string>("");

  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft("Expired");
        clearInterval(interval);
      } else {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setTimeLeft(`${mins}:${secs.toString().padStart(2, "0")}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return (
    <div className="text-center">
      <div className="bg-white p-4 rounded-lg inline-block">
        <div className="w-48 h-48 bg-gray-100 flex items-center justify-center mx-auto">
          {/* Simple QR representation */}
          <div className="text-4xl font-mono font-bold text-gray-800">{token.slice(0, 4)}</div>
        </div>
        <div className="mt-2 text-2xl font-mono font-bold tracking-widest">{token}</div>
      </div>
      {timeLeft && (
        <p className={`mt-2 ${timeLeft === "Expired" ? "text-red-500" : "text-gray-500"}`}>
          {timeLeft === "Expired" ? "Code expired" : `Expires in: ${timeLeft}`}
        </p>
      )}
    </div>
  );
}

// Auth Component
function AuthScreen({ onSuccess }: { onSuccess: () => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"TEACHER" | "STUDENT">("STUDENT");
  const [fullName, setFullName] = useState("");
  const [lrn, setLrn] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const result = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });
        if (result?.error) {
          toast.error("Invalid email or password");
        } else {
          onSuccess();
        }
      } else {
        await api.post("/api/auth/signup", {
          email,
          password,
          name,
          role,
          fullName: role === "STUDENT" ? fullName : undefined,
          lrn: role === "STUDENT" ? lrn : undefined,
        });
        toast.success("Account created! Please sign in.");
        setIsLogin(true);
      }
    } catch (error: unknown) {
      toast.error((error as Error).message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-emerald-50 to-teal-100">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-2xl">Class Record</CardTitle>
          <CardDescription>
            {isLogin ? "Sign in to your account" : "Create a new account"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="your@email.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                minLength={6}
              />
            </div>
            {!isLogin && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="name">Display Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="Your name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">I am a</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as "TEACHER" | "STUDENT")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TEACHER">Teacher</SelectItem>
                      <SelectItem value="STUDENT">Student</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {role === "STUDENT" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="fullName">Full Name (as in records)</Label>
                      <Input
                        id="fullName"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        placeholder="Juan Dela Cruz"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lrn">LRN (Learner Reference Number)</Label>
                      <Input
                        id="lrn"
                        value={lrn}
                        onChange={(e) => setLrn(e.target.value)}
                        required
                        placeholder="12-digit LRN"
                        maxLength={12}
                      />
                    </div>
                  </>
                )}
              </>
            )}
            <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
              {loading ? "Please wait..." : isLogin ? "Sign In" : "Create Account"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setIsLogin(!isLogin)}
            >
              {isLogin ? "Need an account? Sign up" : "Already have an account? Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// Teacher Dashboard
function TeacherDashboard({ goLanding }: { goLanding: () => void }) {
  const [selectedClass, setSelectedClass] = useState<ClassData | null>(null);
  const [activeTab, setActiveTab] = useState("inbox");
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [showCreateActivity, setShowCreateActivity] = useState(false);
  const [showCreateAttendance, setShowCreateAttendance] = useState(false);
  const [showQRCode, setShowQRCode] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<{ id: string; profile: { fullName: string; lrn: string } } | null>(null);
  const [showStudentRecord, setShowStudentRecord] = useState(false);
  
  // Activity management states
  const [showArchived, setShowArchived] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [archiveConfirmActivity, setArchiveConfirmActivity] = useState<Activity | null>(null);
  const [deleteConfirmActivity, setDeleteConfirmActivity] = useState<Activity | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  
  // Grading scheme editing states
  const [editingGradingScheme, setEditingGradingScheme] = useState(false);
  const [tempGradingScheme, setTempGradingScheme] = useState({ ww: 0, pt: 0, qa: 0 });
  
  // Grading period states
  const [showCompletePeriodConfirm, setShowCompletePeriodConfirm] = useState(false);
  const [showReopenPeriodConfirm, setShowReopenPeriodConfirm] = useState(false);
  
  // Generate Next Quarter class state
  const [showGenerateNextQuarterConfirm, setShowGenerateNextQuarterConfirm] = useState(false);
  const [nextQuarterClassName, setNextQuarterClassName] = useState("");
  
  // Class renaming state
  const [editingClassName, setEditingClassName] = useState(false);
  const [tempClassName, setTempClassName] = useState("");
  
  // Reminder modal states
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderActivity, setReminderActivity] = useState<Activity | null>(null);
  const [includeStatuses, setIncludeStatuses] = useState<string[]>(["NO_SUBMISSION", "NEEDS_REVISION"]);
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderMessage, setReminderMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  
  const queryClient = useQueryClient();

  // Queries
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/api/me"),
  });

  const { data: classes = [] } = useQuery({
    queryKey: ["classes"],
    queryFn: () => api.get("/api/classes"),
  });

  const { data: approvals, isLoading: approvalsLoading } = useQuery({
    queryKey: ["approvals", selectedClass?.id],
    queryFn: () => api.get(`/api/approval?classId=${selectedClass?.id || ""}`),
    enabled: activeTab === "inbox" || !!selectedClass,
  });

  const { data: classDetails } = useQuery({
    queryKey: ["class", selectedClass?.id, showArchived],
    queryFn: () => api.get(`/api/classes/${selectedClass?.id}?includeArchived=${showArchived}`),
    enabled: !!selectedClass,
  });

  // At Risk Students Query
  const { data: atRiskStudents = [] } = useQuery({
    queryKey: ["atRisk", selectedClass?.id],
    queryFn: async () => {
      if (!selectedClass) return [];
      const data = await api.get(`/api/export?classId=${selectedClass.id}`);
      const students = data.students || [];
      const activities = data.activities || [];
      return students
        .filter((s: { grade: { transmutedGrade: number }; submissions: { length: number } }) => 
          s.grade.transmutedGrade < 75 || s.submissions.length < activities.length * 0.7
        )
        .map((s: { studentId: string; studentName: string; grade: { transmutedGrade: number }; submissions: { length: number } }) => ({
          studentId: s.studentId,
          studentName: s.studentName,
          currentGrade: s.grade.transmutedGrade,
          missingSubmissions: activities.length - s.submissions.length,
        }));
    },
    enabled: !!selectedClass,
  });

  // Missing students for reminder modal
  const { data: missingStudentsData, isLoading: missingStudentsLoading } = useQuery({
    queryKey: ["missingStudents", reminderActivity?.id],
    queryFn: () => api.get(`/api/teacher/activities/${reminderActivity?.id}/missing`),
    enabled: !!reminderActivity,
  });

  // Send notification mutation
  const sendNotificationMutation = useMutation({
    mutationFn: (data: { activityId: string; includeStatuses: string[]; title: string; messageTemplate: string }) => 
      api.post(`/api/teacher/activities/${data.activityId}/notify`, data),
    onSuccess: (data: { recipientCount: number }) => {
      queryClient.invalidateQueries({ queryKey: ["missingStudents"] });
      setShowReminderModal(false);
      setReminderActivity(null);
      toast.success(`Reminder sent to ${data.recipientCount} students!`);
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Student Record Query
  const { data: studentRecord, isLoading: studentRecordLoading } = useQuery({
    queryKey: ["studentRecord", selectedClass?.id, selectedStudent?.id],
    queryFn: async () => {
      if (!selectedClass || !selectedStudent) return null;
      const data = await api.get(`/api/export?classId=${selectedClass.id}`);
      const student = data.students?.find((s: { studentId: string }) => s.studentId === selectedStudent.id);
      
      // Get all submissions for this student
      const submissions = await api.get(`/api/submissions?studentId=${selectedStudent.id}`);
      
      // Get audit logs for this student
      const auditLogs = await api.get(`/api/audit?studentId=${selectedStudent.id}`);
      
      return {
        ...student,
        allSubmissions: submissions,
        auditLogs: auditLogs || [],
      };
    },
    enabled: !!selectedClass && !!selectedStudent && showStudentRecord,
  });

  // Create class mutation
  const createClassMutation = useMutation({
    mutationFn: (data: unknown) => api.post("/api/classes", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      setShowCreateClass(false);
      toast.success("Class created successfully!");
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Create activity mutation
  const createActivityMutation = useMutation({
    mutationFn: (data: unknown) => api.post("/api/activities", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["class", selectedClass?.id] });
      setShowCreateActivity(false);
      toast.success("Activity created successfully!");
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Update activity mutation (for editing)
  const updateActivityMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) => api.put(`/api/activities/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["class", selectedClass?.id] });
      setEditingActivity(null);
      toast.success("Activity updated successfully!");
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Archive/Unarchive activity mutation
  const archiveActivityMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: "archive" | "unarchive"; reason?: string }) => 
      api.put(`/api/activities/${id}`, { action, archiveReason: reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["class", selectedClass?.id] });
      setArchiveConfirmActivity(null);
      toast.success("Activity archived successfully!");
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Delete activity mutation (permanent)
  const deleteActivityMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/activities/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["class", selectedClass?.id] });
      setDeleteConfirmActivity(null);
      setDeleteConfirmText("");
      toast.success("Activity permanently deleted!");
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Update grading scheme mutation
  const updateGradingSchemeMutation = useMutation({
    mutationFn: (data: { classId: string; gradingScheme: { writtenWorksPercent: number; performanceTasksPercent: number; quarterlyAssessmentPercent: number } }) => 
      api.put(`/api/classes/${data.classId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["class", selectedClass?.id] });
      setEditingGradingScheme(false);
      toast.success("Grading scheme updated successfully!");
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Grading period status mutation
  const gradingPeriodMutation = useMutation({
    mutationFn: (data: { classId: string; gradingPeriodAction: "complete" | "reopen"; reason?: string }) => 
      api.put(`/api/classes/${data.classId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["class", selectedClass?.id] });
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      setShowCompletePeriodConfirm(false);
      setShowReopenPeriodConfirm(false);
      toast.success("Grading period updated successfully!");
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Generate Next Quarter class mutation
  const generateNextQuarterMutation = useMutation({
    mutationFn: ({ classId, name }: { classId: string; name?: string }) => 
      api.put(`/api/classes/${classId}`, { generateNextQuarter: true, name }),
    onSuccess: (data: { class: { id: string; name: string; quarter: number } }) => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      queryClient.invalidateQueries({ queryKey: ["class", selectedClass?.id] });
      setShowGenerateNextQuarterConfirm(false);
      setNextQuarterClassName("");
      toast.success(`Q${data.class.quarter} class "${data.class.name}" created with copied roster!`);
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Rename class mutation
  const renameClassMutation = useMutation({
    mutationFn: ({ classId, name }: { classId: string; name: string }) => 
      api.put(`/api/classes/${classId}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      queryClient.invalidateQueries({ queryKey: ["class", selectedClass?.id] });
      setEditingClassName(false);
      toast.success("Class renamed successfully!");
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Missing students query
  const { data: missingData, isLoading: missingLoading } = useQuery({
    queryKey: ["missingStudents", reminderActivity?.id],
    queryFn: () => api.get(`/api/teacher/activities/${reminderActivity?.id}/missing`),
    enabled: !!reminderActivity,
  });

  // Send notifications mutation
  const sendNotificationsMutation = useMutation({
    mutationFn: (data: { activityId: string; includeStatuses: string[]; messageTemplate: string; title: string }) =>
      api.post(`/api/teacher/activities/${data.activityId}/notify`, data),
    onSuccess: (data: { recipientCount: number }) => {
      setShowReminderModal(false);
      setReminderActivity(null);
      toast.success(`Reminder sent to ${data.recipientCount} students!`);
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Create attendance session mutation
  const createAttendanceMutation = useMutation({
    mutationFn: (data: unknown) => api.post("/api/attendance", data),
    onSuccess: (data: { qrToken: string }) => {
      queryClient.invalidateQueries({ queryKey: ["class", selectedClass?.id] });
      setShowCreateAttendance(false);
      if (data.qrToken) {
        setShowQRCode(data.qrToken);
      }
      toast.success("Attendance session created!");
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Approve/decline mutation
  const reviewMutation = useMutation({
    mutationFn: ({ id, data, type }: { id: string; data: unknown; type: "score" | "attendance" }) => {
      if (type === "score") {
        return api.put(`/api/submissions/${id}`, data);
      }
      return api.put(`/api/approval/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      toast.success("Submission reviewed!");
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Stats
  const stats = {
    totalClasses: classes.length,
    pendingApprovals: (approvals?.stats?.pendingScores || 0) + (approvals?.stats?.pendingAttendance || 0),
    approvedToday: approvals?.stats?.approvedToday || 0,
    atRiskCount: atRiskStudents.length,
  };

  // Export function
  const handleExport = useCallback(async (format: "json" | "excel") => {
    if (!selectedClass) return;
    try {
      if (format === "excel") {
        const response = await fetch(`/api/export?classId=${selectedClass.id}&format=excel`);
        if (!response.ok) throw new Error("Export failed");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `class_record_${selectedClass.section}_Q${selectedClass.quarter}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Excel file downloaded!");
      } else {
        window.open(`/api/export?classId=${selectedClass.id}&format=json`, "_blank");
      }
    } catch {
      toast.error("Failed to export");
    }
  }, [selectedClass]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-emerald-600 text-white sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-white hover:bg-emerald-700"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            <BookOpen className="w-6 h-6" />
            <h1 className="text-lg font-semibold">Teacher Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="text-white hover:bg-emerald-700 relative">
              <Bell className="w-5 h-5" />
              {stats.pendingApprovals > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center">
                  {stats.pendingApprovals}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-emerald-700"
              onClick={goLanding}
              title="Home"
            >
              <Home className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-emerald-700"
              onClick={() => setShowLogoutConfirm(true)}
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar */}
        <aside className={`
          fixed lg:static inset-y-0 left-0 z-40 w-64 bg-white border-r transform transition-transform lg:transform-none
          ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
          pt-16 lg:pt-0
        `}>
          <div className="p-4 space-y-4">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-2">
              <Card className="p-3">
                <div className="text-2xl font-bold text-emerald-600">{stats.totalClasses}</div>
                <div className="text-xs text-gray-500">Classes</div>
              </Card>
              <Card className="p-3">
                <div className="text-2xl font-bold text-amber-600">{stats.pendingApprovals}</div>
                <div className="text-xs text-gray-500">Pending</div>
              </Card>
            </div>

            {/* Navigation */}
            <nav className="space-y-1">
              <Button
                variant={activeTab === "inbox" ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => { setActiveTab("inbox"); setMobileMenuOpen(false); }}
              >
                <ClipboardCheck className="w-4 h-4" />
                Approval Inbox
                {stats.pendingApprovals > 0 && (
                  <Badge variant="destructive" className="ml-auto">{stats.pendingApprovals}</Badge>
                )}
              </Button>
              <Button
                variant={activeTab === "classes" ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => { setActiveTab("classes"); setMobileMenuOpen(false); }}
              >
                <Home className="w-4 h-4" />
                My Classes
              </Button>
              <Button
                variant={activeTab === "analytics" ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => { setActiveTab("analytics"); setMobileMenuOpen(false); }}
              >
                <BarChart3 className="w-4 h-4" />
                Analytics
              </Button>
              <Button
                variant={activeTab === "reports" ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => { setActiveTab("reports"); setMobileMenuOpen(false); }}
              >
                <Printer className="w-4 h-4" />
                Reports
              </Button>
            </nav>

            <Separator />

            {/* Class List */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-500">Quick Access</span>
                <Button size="sm" variant="ghost" onClick={() => setShowCreateClass(true)}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <ScrollArea className="h-48">
                <div className="space-y-1">
                  {classes.map((cls: ClassData) => (
                    <Button
                      key={cls.id}
                      variant={selectedClass?.id === cls.id ? "secondary" : "ghost"}
                      className="w-full justify-start text-sm"
                      onClick={() => {
                        setSelectedClass(cls);
                        setActiveTab("class");
                        setMobileMenuOpen(false);
                      }}
                    >
                      <span className="truncate">{cls.name}</span>
                      <ChevronRight className="w-4 h-4 ml-auto" />
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {/* Approval Inbox */}
          {activeTab === "inbox" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Approval Inbox</h2>
                <Select
                  value={selectedClass?.id || "all"}
                  onValueChange={(v) => {
                    const cls = classes.find((c: ClassData) => c.id === v);
                    setSelectedClass(cls || null);
                  }}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Filter by class" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Classes</SelectItem>
                    {classes.map((cls: ClassData) => (
                      <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* At Risk Students Widget */}
              {selectedClass && atRiskStudents.length > 0 && (
                <Card className="border-red-200 bg-red-50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-red-700">
                      <AlertTriangle className="w-4 h-4" />
                      At-Risk Students ({atRiskStudents.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-32">
                      <div className="space-y-1">
                        {atRiskStudents.map((student: AtRiskStudent) => (
                          <div key={student.studentId} className="flex items-center justify-between p-2 bg-white rounded">
                            <div>
                              <span className="font-medium text-sm">{student.studentName}</span>
                              <span className="text-xs text-gray-500 ml-2">
                                Grade: {student.currentGrade}
                              </span>
                            </div>
                            <Badge variant="outline" className="text-red-600 border-red-300">
                              {student.missingSubmissions} missing
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {approvalsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
                </div>
              ) : (
                <Tabs defaultValue="scores">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="scores">
                      Score Submissions
                      {approvals?.scores?.filter((s: Submission) => s.status === "PENDING").length > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {approvals.scores.filter((s: Submission) => s.status === "PENDING").length}
                        </Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="attendance">
                      Attendance
                      {approvals?.attendance?.filter((a: { submissionStatus: string }) => a.submissionStatus === "PENDING").length > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {approvals.attendance.filter((a: { submissionStatus: string }) => a.submissionStatus === "PENDING").length}
                        </Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="scores" className="space-y-3 mt-4">
                    {approvals?.scores?.length === 0 ? (
                      <Card className="p-8 text-center text-gray-500">
                        <CheckCircle className="w-12 h-12 mx-auto mb-2 text-emerald-500" />
                        <p>All caught up! No pending submissions.</p>
                      </Card>
                    ) : (
                      approvals?.scores?.map((submission: Submission) => (
                        <Card key={submission.id} className="overflow-hidden">
                          <div className="flex flex-col sm:flex-row">
                            <div className="flex-1 p-4">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <h3 className="font-medium">{submission.activity.title}</h3>
                                  <p className="text-sm text-gray-500">
                                    {submission.student?.studentProfile?.fullName || submission.student?.name}
                                  </p>
                                </div>
                                <Badge variant={
                                  submission.status === "APPROVED" ? "default" :
                                  submission.status === "DECLINED" ? "destructive" :
                                  submission.status === "NEEDS_REVISION" ? "secondary" : "outline"
                                }>
                                  {submission.status.replace("_", " ")}
                                </Badge>
                              </div>
                              <div className="mt-2 flex items-center gap-4 text-sm">
                                <span className="font-semibold text-lg">
                                  {submission.rawScore} / {submission.activity.maxScore}
                                </span>
                                <span className="text-gray-500">
                                  {Math.round((submission.rawScore / submission.activity.maxScore) * 100)}%
                                </span>
                                <span className="text-gray-400 text-xs">
                                  {format(new Date(submission.submittedAt), "MMM d, h:mm a")}
                                </span>
                              </div>
                              {submission.notes && (
                                <p className="text-sm text-gray-600 mt-2 bg-gray-50 p-2 rounded">
                                  "{submission.notes}"
                                </p>
                              )}
                              {submission.teacherFeedback && (
                                <p className="text-sm text-amber-700 mt-2 bg-amber-50 p-2 rounded">
                                  Feedback: {submission.teacherFeedback}
                                </p>
                              )}
                            </div>
                            {submission.status === "PENDING" && (
                              <div className="flex sm:flex-col gap-2 p-4 bg-gray-50 sm:bg-transparent">
                                <ReviewDialog
                                  submission={submission}
                                  onReview={(data) => reviewMutation.mutate({
                                    id: submission.id,
                                    data,
                                    type: "score"
                                  })}
                                />
                              </div>
                            )}
                          </div>
                        </Card>
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="attendance" className="space-y-3 mt-4">
                    {approvals?.attendance?.length === 0 ? (
                      <Card className="p-8 text-center text-gray-500">
                        <CheckCircle className="w-12 h-12 mx-auto mb-2 text-emerald-500" />
                        <p>No attendance submissions to review.</p>
                      </Card>
                    ) : (
                      approvals?.attendance?.map((attendance: {
                        id: string;
                        status: string;
                        session: { date: string; title?: string; class: { name: string } };
                        student: { studentProfile?: { fullName: string }; name?: string };
                        submissionStatus: string;
                        teacherFeedback?: string;
                      }) => (
                        <Card key={attendance.id} className="p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="font-medium">
                                {attendance.session.title || format(new Date(attendance.session.date), "MMMM d, yyyy")}
                              </h3>
                              <p className="text-sm text-gray-500">
                                {attendance.student?.studentProfile?.fullName || attendance.student?.name}
                              </p>
                              <div className="mt-2 flex items-center gap-2">
                                <Badge variant={
                                  attendance.status === "PRESENT" ? "default" :
                                  attendance.status === "LATE" ? "secondary" : "destructive"
                                }>
                                  {attendance.status}
                                </Badge>
                                <span className="text-xs text-gray-400">
                                  {attendance.session.class.name}
                                </span>
                              </div>
                            </div>
                            <Badge variant={
                              attendance.submissionStatus === "APPROVED" ? "default" :
                              attendance.submissionStatus === "DECLINED" ? "destructive" : "outline"
                            }>
                              {attendance.submissionStatus}
                            </Badge>
                          </div>
                        </Card>
                      ))
                    )}
                  </TabsContent>
                </Tabs>
              )}
            </div>
          )}

          {/* Classes Tab */}
          {activeTab === "classes" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">My Classes</h2>
                <Button onClick={() => setShowCreateClass(true)} className="bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="w-4 h-4 mr-2" />
                  New Class
                </Button>
              </div>

              {classes.length === 0 ? (
                <Card className="p-8 text-center">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <h3 className="text-lg font-medium mb-2">No classes yet</h3>
                  <p className="text-gray-500 mb-4">Create your first class to get started</p>
                  <Button onClick={() => setShowCreateClass(true)} className="bg-emerald-600">
                    Create Class
                  </Button>
                </Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {classes.map((cls: ClassData) => (
                    <Card
                      key={cls.id}
                      className="cursor-pointer hover:shadow-lg transition-shadow"
                      onClick={() => {
                        setSelectedClass(cls);
                        setActiveTab("class");
                      }}
                    >
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          {cls.name}
                          {cls.semester === 1 ? (
                            <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-xs">Sem 1</Badge>
                          ) : cls.semester === 2 ? (
                            <Badge className="bg-purple-600 text-xs">Sem 2</Badge>
                          ) : null}
                        </CardTitle>
                        <CardDescription>{cls.subject} - {cls.section}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center justify-between text-sm text-gray-500">
                          <span>{cls.quarterRange || `Q${cls.quarter}`} | {cls.schoolYear}</span>
                          <Badge variant="outline">{cls.code}</Badge>
                        </div>
                        <div className="mt-3 flex items-center gap-4 text-sm">
                          <div className="flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            <span>{(cls as { _count?: { enrollments?: number } })._count?.enrollments || 0}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <FileText className="w-4 h-4" />
                            <span>{(cls as { _count?: { activities?: number } })._count?.activities || 0}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Class Detail */}
          {activeTab === "class" && selectedClass && classDetails && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    {classDetails.name}
                    {classDetails.semester === 1 ? (
                      <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-xs">Sem 1</Badge>
                    ) : classDetails.semester === 2 ? (
                      <Badge className="bg-purple-600 text-xs">Sem 2</Badge>
                    ) : null}
                  </h2>
                  <p className="text-gray-500">
                    {classDetails.subject} - {classDetails.section}
                    <span className="mx-2">•</span>
                    <span className="text-sm">{classDetails.quarterRange || `Q${classDetails.quarter}`}</span>
                    <span className="mx-2">•</span>
                    <span className="text-sm">{classDetails.schoolYear}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="icon">
                        <QrCode className="w-4 h-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Class Join Code</DialogTitle>
                        <DialogDescription>
                          Share this code with students to join your class
                        </DialogDescription>
                      </DialogHeader>
                      <div className="text-center py-8">
                        <div className="text-4xl font-mono font-bold tracking-wider bg-gray-100 p-4 rounded-lg">
                          {classDetails.code}
                        </div>
                        <p className="text-sm text-gray-500 mt-4">
                          Students can join by entering this code in their app
                        </p>
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Button variant="outline" size="icon" onClick={() => handleExport("excel")}>
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <Tabs defaultValue="activities">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="activities">Activities</TabsTrigger>
                  <TabsTrigger value="attendance">Attendance</TabsTrigger>
                  <TabsTrigger value="students">Students</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>

                <TabsContent value="activities" className="space-y-4 mt-4">
                  <div className="flex justify-between items-center">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(e) => setShowArchived(e.target.checked)}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      <span className="text-sm text-gray-600">Show Archived ({classDetails._count?.archivedActivities || 0})</span>
                    </label>
                    <Button 
                      onClick={() => setShowCreateActivity(true)} 
                      size="sm"
                      disabled={classDetails.gradingPeriodStatus === "COMPLETED"}
                      title={classDetails.gradingPeriodStatus === "COMPLETED" ? "Cannot add activities after grading period is completed" : ""}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Activity
                    </Button>
                    {classDetails.gradingPeriodStatus === "COMPLETED" && (
                      <span className="text-xs text-amber-600">Grading period completed - new activities disabled</span>
                    )}
                  </div>

                  {["WRITTEN_WORK", "PERFORMANCE_TASK", "QUARTERLY_ASSESSMENT"].map((category) => {
                    const activities = classDetails.activities?.filter((a: Activity) => a.category === category) || [];
                    const archivedCount = activities.filter((a: Activity) => a.archived).length;
                    return (
                      <Card key={category}>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium flex items-center gap-2">
                            {category === "WRITTEN_WORK" && <FileText className="w-4 h-4" />}
                            {category === "PERFORMANCE_TASK" && <Award className="w-4 h-4" />}
                            {category === "QUARTERLY_ASSESSMENT" && <ClipboardCheck className="w-4 h-4" />}
                            {category.replace("_", " ")}
                            <Badge variant="outline" className="ml-auto">
                              {classDetails.gradingScheme?.[
                                category === "WRITTEN_WORK" ? "writtenWorksPercent" :
                                category === "PERFORMANCE_TASK" ? "performanceTasksPercent" :
                                "quarterlyAssessmentPercent"
                              ]}%
                            </Badge>
                            {archivedCount > 0 && showArchived && (
                              <Badge variant="secondary" className="text-xs">
                                {archivedCount} archived
                              </Badge>
                            )}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {activities.length === 0 ? (
                            <p className="text-sm text-gray-400 py-2">No activities yet</p>
                          ) : (
                            activities.map((activity: Activity) => (
                              <div 
                                key={activity.id} 
                                className={`flex items-center justify-between p-2 rounded ${
                                  activity.archived 
                                    ? "bg-gray-200 border border-dashed border-gray-300 opacity-75" 
                                    : "bg-gray-50"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  {activity.archived && <Archive className="w-4 h-4 text-gray-400" />}
                                  <div>
                                    <span className={`font-medium ${activity.archived ? "text-gray-500 line-through" : ""}`}>
                                      {activity.title}
                                    </span>
                                    <span className="text-sm text-gray-500 ml-2">
                                      ({activity.maxScore} pts)
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {activity.dueDate && !activity.archived && (
                                    <span className="text-xs text-gray-400">
                                      Due: {format(new Date(activity.dueDate), "MMM d")}
                                    </span>
                                  )}
                                  {activity.archived && (
                                    <span className="text-xs text-gray-400">
                                      Archived
                                    </span>
                                  )}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-8 w-8">
                                        <MoreVertical className="w-4 h-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => setEditingActivity(activity)}>
                                        <Edit className="w-4 h-4 mr-2" />
                                        Edit
                                      </DropdownMenuItem>
                                      <DropdownMenuItem 
                                        onClick={() => {
                                          setReminderActivity(activity);
                                          setReminderTitle(`Reminder: ${activity.title}`);
                                          setReminderMessage(`Hi {StudentName}, you still have a pending requirement for: ${activity.title}. Please submit/resolve it before ${activity.dueDate ? new Date(activity.dueDate).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }) : "the deadline"}. If you already submitted, disregard this message. — {TeacherName}`);
                                          setShowReminderModal(true);
                                        }}
                                      >
                                        <Bell className="w-4 h-4 mr-2" />
                                        Remind Missing
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      {activity.archived ? (
                                        <DropdownMenuItem 
                                          onClick={() => archiveActivityMutation.mutate({ 
                                            id: activity.id, 
                                            action: "unarchive" 
                                          })}
                                        >
                                          <ArchiveRestore className="w-4 h-4 mr-2" />
                                          Restore
                                        </DropdownMenuItem>
                                      ) : (
                                        <DropdownMenuItem 
                                          onClick={() => setArchiveConfirmActivity(activity)}
                                          className="text-amber-600"
                                        >
                                          <Archive className="w-4 h-4 mr-2" />
                                          Archive
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem 
                                        onClick={() => setDeleteConfirmActivity(activity)}
                                        className="text-red-600"
                                      >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Delete Permanently
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>
                            ))
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </TabsContent>

                <TabsContent value="attendance" className="space-y-4 mt-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-medium">Attendance Sessions</h3>
                    <Button onClick={() => setShowCreateAttendance(true)} size="sm">
                      <Plus className="w-4 h-4 mr-2" />
                      New Session
                    </Button>
                  </div>
                  {classDetails.attendanceSessions?.map((session: { id: string; date: string; title?: string; qrToken?: string; qrExpiresAt?: string }) => (
                    <Card key={session.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">
                            {session.title || format(new Date(session.date), "MMMM d, yyyy")}
                          </h4>
                          <p className="text-sm text-gray-500">
                            {format(new Date(session.date), "MMM d, yyyy h:mm a")}
                          </p>
                        </div>
                        {session.qrToken && (
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm">
                                <QrCode className="w-4 h-4 mr-2" />
                                Show QR
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Attendance QR Code</DialogTitle>
                              </DialogHeader>
                              <QRCodeDisplay token={session.qrToken} expiresAt={session.qrExpiresAt} />
                            </DialogContent>
                          </Dialog>
                        )}
                      </div>
                    </Card>
                  ))}
                </TabsContent>

                <TabsContent value="students" className="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Enrolled Students ({classDetails.enrollments?.length || 0})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-64">
                        <div className="space-y-2">
                          {classDetails.enrollments?.map((enrollment: { id: string; studentId: string; profile: { fullName: string; lrn: string } }) => (
                            <div 
                              key={enrollment.id} 
                              className="flex items-center justify-between p-3 bg-gray-50 rounded cursor-pointer hover:bg-gray-100 transition-colors"
                              onClick={() => {
                                setSelectedStudent({ id: enrollment.studentId, profile: enrollment.profile });
                                setShowStudentRecord(true);
                              }}
                            >
                              <div>
                                <p className="font-medium">{enrollment.profile.fullName}</p>
                                <p className="text-xs text-gray-500">LRN: {enrollment.profile.lrn}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button variant="ghost" size="sm" onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedStudent({ id: enrollment.studentId, profile: enrollment.profile });
                                  setShowStudentRecord(true);
                                }}>
                                  <Eye className="w-4 h-4 mr-1" />
                                  View Record
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="settings" className="mt-4 space-y-4">
                  {/* Class Details Card */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Class Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Class Name - Editable */}
                      <div className="space-y-2">
                        <Label className="text-xs">Class Name</Label>
                        {editingClassName ? (
                          <div className="flex gap-2">
                            <Input
                              value={tempClassName}
                              onChange={(e) => setTempClassName(e.target.value)}
                              placeholder="Enter class name"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEditingClassName(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="bg-emerald-600"
                              onClick={() => {
                                renameClassMutation.mutate({
                                  classId: selectedClass?.id || "",
                                  name: tempClassName,
                                });
                              }}
                              disabled={renameClassMutation.isPending || !tempClassName.trim()}
                            >
                              Save
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{classDetails.name}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setTempClassName(classDetails.name);
                                setEditingClassName(true);
                              }}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      
                      {/* Read-only details */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs">Subject</Label>
                          <p className="text-sm font-medium">{classDetails.subject}</p>
                        </div>
                        <div>
                          <Label className="text-xs">Section</Label>
                          <p className="text-sm font-medium">{classDetails.section}</p>
                        </div>
                        <div>
                          <Label className="text-xs">School Year</Label>
                          <p className="text-sm font-medium">{classDetails.schoolYear}</p>
                        </div>
                        <div>
                          <Label className="text-xs">Quarter</Label>
                          <p className="text-sm font-medium">Q{classDetails.quarter} (Semester {classDetails.quarter <= 2 ? "1" : "2"})</p>
                        </div>
                        <div className="col-span-2">
                          <Label className="text-xs">Class Code</Label>
                          <div className="flex items-center gap-2">
                            <code className="bg-gray-100 px-2 py-1 rounded text-sm font-mono">{classDetails.code}</code>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                navigator.clipboard.writeText(classDetails.code);
                                toast.success("Class code copied!");
                              }}
                            >
                              Copy
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  
                  {/* Grading Period Status Card */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        Grading Period Status
                        {classDetails.gradingPeriodStatus === "COMPLETED" ? (
                          <Badge className="bg-green-600">Completed</Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 border-amber-300">Open</Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {classDetails.gradingPeriodStatus === "COMPLETED" ? (
                        <>
                          <p className="text-sm text-gray-600">
                            This grading period was marked as completed on{" "}
                            {classDetails.gradingPeriodCompletedAt 
                              ? format(new Date(classDetails.gradingPeriodCompletedAt), "MMMM d, yyyy 'at' h:mm a")
                              : "N/A"
                            }.
                          </p>
                          <p className="text-sm text-gray-500">
                            Students can now see their Current Grade (approved-only). No new activities can be added.
                          </p>
                          <Button
                            variant="outline"
                            onClick={() => setShowReopenPeriodConfirm(true)}
                            className="text-amber-600 border-amber-300 hover:bg-amber-50"
                          >
                            Re-open Grading Period
                          </Button>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-gray-600">
                            The grading period is currently <strong>open</strong>. Students can only see their Tentative Grade.
                          </p>
                          <p className="text-sm text-gray-500">
                            Once completed, students will see their Current Grade (approved-only), and no new activities can be added.
                          </p>
                          <Button
                            className="bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => setShowCompletePeriodConfirm(true)}
                          >
                            Mark Grading Period Complete
                          </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>
                  
                  {/* Quarter Management Card */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        Quarter Management
                        <Badge className={`
                          ${classDetails.quarter === 1 ? "bg-emerald-600" : ""}
                          ${classDetails.quarter === 2 ? "bg-blue-600" : ""}
                          ${classDetails.quarter === 3 ? "bg-amber-600" : ""}
                          ${classDetails.quarter === 4 ? "bg-purple-600" : ""}
                        `}>
                          Q{classDetails.quarter}
                        </Badge>
                        <Badge variant="outline" className={`
                          ${classDetails.quarter <= 2 ? "text-emerald-600 border-emerald-300" : "text-purple-600 border-purple-300"}
                        `}>
                          Semester {classDetails.quarter <= 2 ? "1" : "2"}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Previous Quarter Link */}
                      {classDetails.linkedFrom && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <p className="text-sm text-blue-700">
                            <strong>Linked from:</strong> {classDetails.linkedFrom.name}
                          </p>
                          <Button
                            variant="link"
                            className="text-blue-700 p-0 h-auto mt-1"
                            onClick={() => {
                              const prevClass = classes.find((c: { id: string }) => c.id === classDetails.linkedFrom?.id);
                              if (prevClass) {
                                setSelectedClass(prevClass);
                                setActiveTab("activities");
                              }
                            }}
                          >
                            → View Q{classDetails.linkedFrom.quarter || "?"} Class
                          </Button>
                        </div>
                      )}
                      
                      {/* Next Quarter Section */}
                      {classDetails.quarter < 4 ? (
                        <>
                          {/* Check if next quarter already exists */}
                          {classDetails.linkedTo && classDetails.linkedTo.length > 0 ? (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                              <p className="text-sm text-green-700 font-medium">
                                ✓ Q{classDetails.quarter + 1} class already exists
                              </p>
                              {classDetails.linkedTo.map((linked: { id: string; name: string; quarter?: number }) => (
                                <Button
                                  key={linked.id}
                                  variant="link"
                                  className="text-green-700 p-0 h-auto mt-1"
                                  onClick={() => {
                                    const nextClass = classes.find((c: { id: string }) => c.id === linked.id);
                                    if (nextClass) {
                                      setSelectedClass(nextClass);
                                      setActiveTab("activities");
                                    }
                                  }}
                                >
                                  → {linked.name} (Q{linked.quarter || "?"})
                                </Button>
                              ))}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <p className="text-sm text-gray-600">
                                Generate the next quarter class. All students will be automatically enrolled.
                              </p>
                              <Button
                                variant="outline"
                                className="border-emerald-300 text-emerald-600 hover:bg-emerald-50"
                                onClick={() => {
                                  setNextQuarterClassName(`${classDetails.name} - Q${classDetails.quarter + 1}`);
                                  setShowGenerateNextQuarterConfirm(true);
                                }}
                                disabled={generateNextQuarterMutation.isPending}
                              >
                                <Plus className="w-4 h-4 mr-2" />
                                Generate Q{classDetails.quarter + 1} Class
                              </Button>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                          <p className="text-sm text-gray-600">
                            This is Q4 - the final quarter. No further quarter classes can be generated.
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  
                  {/* Grading Scheme Card */}
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">Grading Scheme</CardTitle>
                        {!editingGradingScheme && classDetails.gradingPeriodStatus !== "COMPLETED" && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => {
                              setTempGradingScheme({
                                ww: classDetails.gradingScheme?.writtenWorksPercent || 30,
                                pt: classDetails.gradingScheme?.performanceTasksPercent || 50,
                                qa: classDetails.gradingScheme?.quarterlyAssessmentPercent || 20,
                              });
                              setEditingGradingScheme(true);
                            }}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                        )}
                        {classDetails.gradingPeriodStatus === "COMPLETED" && (
                          <Badge variant="outline" className="text-gray-500">Locked</Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {editingGradingScheme ? (
                        <>
                          <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-2">
                              <Label className="text-xs">Written Works %</Label>
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                value={tempGradingScheme.ww}
                                onChange={(e) => setTempGradingScheme(prev => ({ ...prev, ww: parseFloat(e.target.value) || 0 }))}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs">Performance Tasks %</Label>
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                value={tempGradingScheme.pt}
                                onChange={(e) => setTempGradingScheme(prev => ({ ...prev, pt: parseFloat(e.target.value) || 0 }))}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs">Quarterly Assessment %</Label>
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                value={tempGradingScheme.qa}
                                onChange={(e) => setTempGradingScheme(prev => ({ ...prev, qa: parseFloat(e.target.value) || 0 }))}
                              />
                            </div>
                          </div>
                          
                          {/* Total indicator */}
                          <div className={`flex items-center justify-between p-3 rounded-lg ${
                            Math.abs(tempGradingScheme.ww + tempGradingScheme.pt + tempGradingScheme.qa - 100) < 0.01
                              ? "bg-green-50 border border-green-200"
                              : "bg-red-50 border border-red-200"
                          }`}>
                            <span className="font-medium">Total:</span>
                            <span className={`text-xl font-bold ${
                              Math.abs(tempGradingScheme.ww + tempGradingScheme.pt + tempGradingScheme.qa - 100) < 0.01
                                ? "text-green-600"
                                : "text-red-600"
                            }`}>
                              {(tempGradingScheme.ww + tempGradingScheme.pt + tempGradingScheme.qa).toFixed(1)}%
                            </span>
                          </div>
                          
                          {/* Validation messages */}
                          {(tempGradingScheme.ww < 0 || tempGradingScheme.ww > 100 ||
                            tempGradingScheme.pt < 0 || tempGradingScheme.pt > 100 ||
                            tempGradingScheme.qa < 0 || tempGradingScheme.qa > 100) && (
                            <p className="text-sm text-red-600">
                              Each percentage must be between 0 and 100
                            </p>
                          )}
                          
                          {/* Action buttons */}
                          <div className="flex justify-end gap-2">
                            <Button 
                              variant="outline" 
                              onClick={() => setEditingGradingScheme(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              className="bg-emerald-600"
                              disabled={Math.abs(tempGradingScheme.ww + tempGradingScheme.pt + tempGradingScheme.qa - 100) >= 0.01 ||
                                tempGradingScheme.ww < 0 || tempGradingScheme.ww > 100 ||
                                tempGradingScheme.pt < 0 || tempGradingScheme.pt > 100 ||
                                tempGradingScheme.qa < 0 || tempGradingScheme.qa > 100 ||
                                updateGradingSchemeMutation.isPending
                              }
                              onClick={() => {
                                updateGradingSchemeMutation.mutate({
                                  classId: selectedClass?.id || "",
                                  gradingScheme: {
                                    writtenWorksPercent: tempGradingScheme.ww,
                                    performanceTasksPercent: tempGradingScheme.pt,
                                    quarterlyAssessmentPercent: tempGradingScheme.qa,
                                  },
                                });
                              }}
                            >
                              <Save className="w-4 h-4 mr-2" />
                              Save Changes
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <Label className="text-xs">Written Works</Label>
                            <div className="text-xl font-semibold">
                              {classDetails.gradingScheme?.writtenWorksPercent}%
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">Performance Tasks</Label>
                            <div className="text-xl font-semibold">
                              {classDetails.gradingScheme?.performanceTasksPercent}%
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">Quarterly Assessment</Label>
                            <div className="text-xl font-semibold">
                              {classDetails.gradingScheme?.quarterlyAssessmentPercent}%
                            </div>
                          </div>
                        </div>
                      )}
                      
                      <p className="text-xs text-gray-500 mt-4">
                        Note: Changing the grading scheme will affect all grade calculations. 
                        Existing submissions remain intact for transparency and audit purposes.
                      </p>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* Analytics Tab */}
          {activeTab === "analytics" && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Analytics Overview</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Total Classes</p>
                        <p className="text-2xl font-bold">{stats.totalClasses}</p>
                      </div>
                      <BookOpen className="w-8 h-8 text-emerald-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Pending Reviews</p>
                        <p className="text-2xl font-bold">{stats.pendingApprovals}</p>
                      </div>
                      <Clock className="w-8 h-8 text-amber-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Approved Today</p>
                        <p className="text-2xl font-bold">{stats.approvedToday}</p>
                      </div>
                      <CheckCircle className="w-8 h-8 text-green-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-red-200">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">At-Risk Students</p>
                        <p className="text-2xl font-bold text-red-600">{stats.atRiskCount}</p>
                      </div>
                      <AlertTriangle className="w-8 h-8 text-red-500" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Reports Tab */}
          {activeTab === "reports" && (
            <ReportsPage
              classes={classes}
              user={user}
            />
          )}
        </main>
      </div>

      {/* Create Class Dialog */}
      <Dialog open={showCreateClass} onOpenChange={setShowCreateClass}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Class</DialogTitle>
            <DialogDescription>Set up a new class for your students</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              createClassMutation.mutate({
                name: formData.get("name"),
                subject: formData.get("subject"),
                section: formData.get("section"),
                schoolYear: formData.get("schoolYear"),
                quarter: parseInt(formData.get("quarter") as string),
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="className">Class Name</Label>
              <Input id="className" name="name" required placeholder="e.g., Mathematics 10" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" name="subject" required placeholder="e.g., Mathematics" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="section">Section</Label>
              <Input id="section" name="section" required placeholder="e.g., Rizal" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="schoolYear">School Year</Label>
                <Input id="schoolYear" name="schoolYear" required placeholder="2024-2025" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quarter">Quarter</Label>
                <Select name="quarter" defaultValue="1">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1st Quarter</SelectItem>
                    <SelectItem value="2">2nd Quarter</SelectItem>
                    <SelectItem value="3">3rd Quarter</SelectItem>
                    <SelectItem value="4">4th Quarter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowCreateClass(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-emerald-600" disabled={createClassMutation.isPending}>
                Create Class
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Activity Dialog */}
      <Dialog open={showCreateActivity} onOpenChange={setShowCreateActivity}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Activity</DialogTitle>
            <DialogDescription>Add a new activity for this class</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              createActivityMutation.mutate({
                classId: selectedClass?.id,
                category: formData.get("category"),
                title: formData.get("title"),
                description: formData.get("description"),
                maxScore: parseFloat(formData.get("maxScore") as string),
                dueDate: formData.get("dueDate") || null,
                instructions: formData.get("instructions"),
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select name="category" required>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WRITTEN_WORK">Written Work</SelectItem>
                  <SelectItem value="PERFORMANCE_TASK">Performance Task</SelectItem>
                  <SelectItem value="QUARTERLY_ASSESSMENT">Quarterly Assessment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="title">Activity Title</Label>
              <Input id="title" name="title" required placeholder="e.g., Quiz 1" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxScore">Maximum Score</Label>
              <Input id="maxScore" name="maxScore" type="number" min="1" step="0.5" required placeholder="e.g., 20" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dueDate">Due Date (optional)</Label>
              <Input id="dueDate" name="dueDate" type="datetime-local" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="instructions">Instructions (optional)</Label>
              <Textarea id="instructions" name="instructions" placeholder="Instructions for students..." />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowCreateActivity(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-emerald-600" disabled={createActivityMutation.isPending}>
                Create Activity
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Activity Dialog */}
      <Dialog open={!!editingActivity} onOpenChange={() => setEditingActivity(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Activity</DialogTitle>
            <DialogDescription>Update activity details</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              updateActivityMutation.mutate({
                id: editingActivity?.id || "",
                data: {
                  title: formData.get("title"),
                  description: formData.get("description"),
                  maxScore: parseFloat(formData.get("maxScore") as string),
                  dueDate: formData.get("dueDate") || null,
                  instructions: formData.get("instructions"),
                  category: formData.get("category"),
                },
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="edit-category">Category</Label>
              <Select name="category" required defaultValue={editingActivity?.category}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WRITTEN_WORK">Written Work</SelectItem>
                  <SelectItem value="PERFORMANCE_TASK">Performance Task</SelectItem>
                  <SelectItem value="QUARTERLY_ASSESSMENT">Quarterly Assessment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-title">Activity Title</Label>
              <Input 
                id="edit-title" 
                name="title" 
                required 
                placeholder="e.g., Quiz 1" 
                defaultValue={editingActivity?.title}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-maxScore">Maximum Score</Label>
              <Input 
                id="edit-maxScore" 
                name="maxScore" 
                type="number" 
                min="1" 
                step="0.5" 
                required 
                placeholder="e.g., 20" 
                defaultValue={editingActivity?.maxScore}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-dueDate">Due Date (optional)</Label>
              <Input 
                id="edit-dueDate" 
                name="dueDate" 
                type="datetime-local" 
                defaultValue={editingActivity?.dueDate ? new Date(editingActivity.dueDate).toISOString().slice(0, 16) : ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-instructions">Instructions (optional)</Label>
              <Textarea 
                id="edit-instructions" 
                name="instructions" 
                placeholder="Instructions for students..."
                defaultValue={editingActivity?.instructions || ""}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingActivity(null)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-emerald-600" disabled={updateActivityMutation.isPending}>
                Update Activity
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Archive Confirmation Dialog */}
      <Dialog open={!!archiveConfirmActivity} onOpenChange={() => setArchiveConfirmActivity(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="w-5 h-5 text-amber-600" />
              Archive Activity
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to archive this activity?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="font-medium">{archiveConfirmActivity?.title}</p>
              <p className="text-sm text-gray-500 mt-1">
                Category: {archiveConfirmActivity?.category?.replace("_", " ")} | Max Score: {archiveConfirmActivity?.maxScore}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 text-sm">
              <p className="text-gray-700">
                <strong>What happens when you archive:</strong>
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-gray-600">
                <li>Students will no longer see this activity</li>
                <li>Existing submissions remain intact for transparency</li>
                <li>You can restore archived activities anytime</li>
              </ul>
            </div>
            <div className="space-y-2">
              <Label htmlFor="archive-reason">Reason (optional)</Label>
              <Textarea
                id="archive-reason"
                placeholder="e.g., Activity cancelled, merged with another..."
                onChange={(e) => {
                  // Store reason for later use
                  (archiveConfirmActivity as Activity & { reason?: string }).reason = e.target.value;
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setArchiveConfirmActivity(null)}>
                Cancel
              </Button>
              <Button
                className="bg-amber-600 hover:bg-amber-700"
                onClick={() => {
                  archiveActivityMutation.mutate({
                    id: archiveConfirmActivity?.id || "",
                    action: "archive",
                    reason: (archiveConfirmActivity as Activity & { reason?: string })?.reason,
                  });
                }}
                disabled={archiveActivityMutation.isPending}
              >
                <Archive className="w-4 h-4 mr-2" />
                Archive Activity
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmActivity} onOpenChange={() => {
        setDeleteConfirmActivity(null);
        setDeleteConfirmText("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              Permanently Delete Activity
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone!
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="font-medium text-red-700">{deleteConfirmActivity?.title}</p>
              <p className="text-sm text-red-600 mt-1">
                Category: {deleteConfirmActivity?.category?.replace("_", " ")} | Max Score: {deleteConfirmActivity?.maxScore}
              </p>
            </div>
            <div className="bg-red-50 rounded-lg p-4 text-sm border border-red-200">
              <p className="text-red-700 font-medium">
                ⚠️ Warning: This will permanently delete:
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-red-600">
                <li>The activity itself</li>
                <li>All student submissions for this activity</li>
                <li>All associated audit records</li>
              </ul>
            </div>
            <div className="space-y-2">
              <Label htmlFor="delete-confirm" className="text-red-600">
                Type <strong>DELETE</strong> to confirm:
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value.toUpperCase())}
                placeholder="DELETE"
                className="border-red-300 focus:border-red-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setDeleteConfirmActivity(null);
                setDeleteConfirmText("");
              }}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  deleteActivityMutation.mutate(deleteConfirmActivity?.id || "");
                }}
                disabled={deleteConfirmText !== "DELETE" || deleteActivityMutation.isPending}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Permanently
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Complete Grading Period Confirmation Dialog */}
      <Dialog open={showCompletePeriodConfirm} onOpenChange={setShowCompletePeriodConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <CheckCircle className="w-5 h-5" />
              Mark Grading Period Complete
            </DialogTitle>
            <DialogDescription>
              This will finalize the grading period for this class.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm">
              <p className="text-emerald-700 font-medium">What happens when you complete the grading period:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-emerald-600">
                <li>Students will see their <strong>Current Grade</strong> (approved-only)</li>
                <li>No new activities can be added</li>
                <li>Grading scheme cannot be modified</li>
                <li>Existing submissions remain intact</li>
              </ul>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
              <p className="text-amber-700 font-medium">⚠️ Important:</p>
              <p className="text-amber-600 mt-1">
                Make sure all submissions have been reviewed before completing. You can re-open the grading period later if needed.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCompletePeriodConfirm(false)}>
                Cancel
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => {
                  gradingPeriodMutation.mutate({
                    classId: selectedClass?.id || "",
                    gradingPeriodAction: "complete",
                  });
                }}
                disabled={gradingPeriodMutation.isPending}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Complete Grading Period
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reopen Grading Period Confirmation Dialog */}
      <Dialog open={showReopenPeriodConfirm} onOpenChange={setShowReopenPeriodConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="w-5 h-5" />
              Re-open Grading Period
            </DialogTitle>
            <DialogDescription>
              This will allow modifications to the grading period again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
              <p className="text-amber-700 font-medium">What happens when you re-open:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-amber-600">
                <li>Teachers can add new activities again</li>
                <li>Grading scheme can be modified</li>
                <li>Students will only see Tentative Grade (until completed again)</li>
              </ul>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm">
              <p className="text-red-700 font-medium">⚠️ Warning:</p>
              <p className="text-red-600 mt-1">
                Re-opening may cause confusion for students who have already seen their final grade.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowReopenPeriodConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                className="text-amber-600 border-amber-300 hover:bg-amber-50"
                onClick={() => {
                  gradingPeriodMutation.mutate({
                    classId: selectedClass?.id || "",
                    gradingPeriodAction: "reopen",
                  });
                }}
                disabled={gradingPeriodMutation.isPending}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Re-open Grading Period
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Generate Next Quarter Class Confirmation Dialog */}
      <Dialog open={showGenerateNextQuarterConfirm} onOpenChange={setShowGenerateNextQuarterConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <Plus className="w-5 h-5" />
              Generate Q{(classDetails?.quarter || 0) + 1} Class
            </DialogTitle>
            <DialogDescription>
              Create a new quarter class with the same roster.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Class Name Input */}
            <div className="space-y-2">
              <Label htmlFor="nextQuarterName">Class Name</Label>
              <Input
                id="nextQuarterName"
                value={nextQuarterClassName}
                onChange={(e) => setNextQuarterClassName(e.target.value)}
                placeholder="Enter class name"
              />
            </div>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
              <p className="text-blue-700 font-medium">This will create:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-blue-600">
                <li>A new class for <strong>Q{(classDetails?.quarter || 0) + 1}</strong> (Semester {(classDetails?.quarter || 0) + 1 <= 2 ? "1" : "2"})</li>
                <li>Same subject, section, and school year</li>
                <li>All {classDetails?.enrollments?.length || 0} students automatically enrolled</li>
                <li>New unique class code</li>
                <li>Copy of your grading scheme settings</li>
              </ul>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm">
              <p className="text-emerald-700 font-medium">✓ Student Experience:</p>
              <p className="text-emerald-600 mt-1">
                Students from Q{classDetails?.quarter || "?"} will see the new quarter class automatically in their list. No need to join again!
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setShowGenerateNextQuarterConfirm(false);
                setNextQuarterClassName("");
              }}>
                Cancel
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => {
                  generateNextQuarterMutation.mutate({
                    classId: selectedClass?.id || "",
                    name: nextQuarterClassName || undefined,
                  });
                }}
                disabled={generateNextQuarterMutation.isPending}
              >
                <Plus className="w-4 h-4 mr-2" />
                Generate Q{(classDetails?.quarter || 0) + 1} Class
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Attendance Session Dialog */}
      <Dialog open={showCreateAttendance} onOpenChange={setShowCreateAttendance}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Attendance Session</DialogTitle>
            <DialogDescription>Set up a new attendance check-in</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              createAttendanceMutation.mutate({
                classId: selectedClass?.id,
                date: formData.get("date"),
                title: formData.get("title"),
                lateThresholdMinutes: parseInt(formData.get("lateThreshold") as string) || 15,
                enableQr: formData.get("enableQr") === "on",
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="attTitle">Session Title (optional)</Label>
              <Input id="attTitle" name="title" placeholder="e.g., Week 1 Attendance" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="attDate">Date & Time</Label>
              <Input id="attDate" name="date" type="datetime-local" required defaultValue={new Date().toISOString().slice(0, 16)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lateThreshold">Late Threshold (minutes)</Label>
              <Input id="lateThreshold" name="lateThreshold" type="number" min="0" defaultValue="15" />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="enableQr" name="enableQr" defaultChecked />
              <Label htmlFor="enableQr">Enable QR Code Check-in</Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowCreateAttendance(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-emerald-600" disabled={createAttendanceMutation.isPending}>
                Create Session
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Student Record Modal */}
      {selectedStudent && (
        <StudentRecordModal
          student={selectedStudent}
          classId={selectedClass?.id || ""}
          isOpen={showStudentRecord}
          onClose={() => {
            setShowStudentRecord(false);
            setSelectedStudent(null);
          }}
          onReview={(id, data, type) => {
            reviewMutation.mutate({ id, data, type });
            queryClient.invalidateQueries({ queryKey: ["studentRecord"] });
          }}
        />
      )}

      {/* Logout Confirmation Dialog */}
      <Dialog open={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Logout</DialogTitle>
            <DialogDescription>
              Are you sure you want to logout?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowLogoutConfirm(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              Logout
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reminder Modal */}
      <Dialog open={showReminderModal} onOpenChange={setShowReminderModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-amber-600" />
              Send Reminder - {reminderActivity?.title}
            </DialogTitle>
            <DialogDescription>
              Notify students about missing or revision-needed submissions.
            </DialogDescription>
          </DialogHeader>
          
          {missingStudentsLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
            </div>
          ) : missingStudentsData ? (
            <div className="space-y-4">
              {/* Counts Summary */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="text-2xl font-bold text-red-600">{missingStudentsData.counts.noSubmission}</div>
                  <div className="text-xs text-red-600">No Submission</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="text-2xl font-bold text-amber-600">{missingStudentsData.counts.needsRevision}</div>
                  <div className="text-xs text-amber-600">Needs Revision</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <div className="text-2xl font-bold text-gray-600">{missingStudentsData.counts.declined}</div>
                  <div className="text-xs text-gray-600">Declined</div>
                </div>
              </div>

              {/* Status Checkboxes */}
              <div className="space-y-2">
                <Label>Include students with:</Label>
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeStatuses.includes("NO_SUBMISSION")}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setIncludeStatuses([...includeStatuses, "NO_SUBMISSION"]);
                        } else {
                          setIncludeStatuses(includeStatuses.filter((s) => s !== "NO_SUBMISSION"));
                        }
                      }}
                      className="w-4 h-4 accent-red-600"
                    />
                    <span className="text-sm">No Submission</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeStatuses.includes("NEEDS_REVISION")}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setIncludeStatuses([...includeStatuses, "NEEDS_REVISION"]);
                        } else {
                          setIncludeStatuses(includeStatuses.filter((s) => s !== "NEEDS_REVISION"));
                        }
                      }}
                      className="w-4 h-4 accent-amber-600"
                    />
                    <span className="text-sm">Needs Revision</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeStatuses.includes("DECLINED")}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setIncludeStatuses([...includeStatuses, "DECLINED"]);
                        } else {
                          setIncludeStatuses(includeStatuses.filter((s) => s !== "DECLINED"));
                        }
                      }}
                      className="w-4 h-4 accent-gray-600"
                    />
                    <span className="text-sm">Declined</span>
                  </label>
                </div>
              </div>

              {/* Recipient Count */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                <span className="text-blue-700">
                  <strong>
                    {missingStudentsData.roster.filter((s: { status: string }) => includeStatuses.includes(s.status)).length}
                  </strong> students will receive this reminder.
                </span>
              </div>

              {/* Title Input */}
              <div className="space-y-2">
                <Label htmlFor="reminderTitle">Title</Label>
                <Input
                  id="reminderTitle"
                  value={reminderTitle}
                  onChange={(e) => setReminderTitle(e.target.value)}
                  placeholder="Reminder: {ActivityTitle}"
                />
              </div>

              {/* Message Template */}
              <div className="space-y-2">
                <Label htmlFor="reminderMessage">Message</Label>
                <Textarea
                  id="reminderMessage"
                  value={reminderMessage}
                  onChange={(e) => setReminderMessage(e.target.value)}
                  rows={4}
                  placeholder="Hi {StudentName}, you still have a pending requirement..."
                />
                <p className="text-xs text-gray-500">
                  Placeholders: {"{StudentName}"}, {"{ActivityTitle}"}, {"{DueDate}"}, {"{TeacherName}"}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowReminderModal(false)}>
                    Cancel
                  </Button>
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700"
                    disabled={includeStatuses.length === 0 || sendNotificationMutation.isPending}
                    onClick={() => {
                      sendNotificationMutation.mutate({
                        activityId: reminderActivity?.id || "",
                        includeStatuses,
                        title: reminderTitle,
                        messageTemplate: reminderMessage,
                      });
                    }}
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Send In-App Reminder
                  </Button>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    // Generate copy-ready text
                    const recipients = missingStudentsData.roster.filter((s: { status: string }) => includeStatuses.includes(s.status));
                    const messageLines = recipients.map((s: { studentName: string }) => {
                      const personalized = reminderMessage
                        .replace(/{StudentName}/g, s.studentName)
                        .replace(/{ActivityTitle}/g, reminderActivity?.title || "")
                        .replace(/{DueDate}/g, reminderActivity?.dueDate ? new Date(reminderActivity.dueDate).toLocaleDateString("en-PH") : "No due date")
                        .replace(/{TeacherName}/g, user?.name || "Your Teacher");
                      return `${s.studentName}:\n${personalized}`;
                    });
                    const fullMessage = `📋 ${reminderTitle}\n\n${messageLines.join("\n\n")}`;
                    navigator.clipboard.writeText(fullMessage);
                    toast.success("Message copied to clipboard! Paste in Messenger/SMS.");
                  }}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Message for Messenger/SMS
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Offline Indicator */}
      <OfflineIndicator />
    </div>
  );
}

// Review Dialog Component
function ReviewDialog({
  submission,
  onReview,
}: {
  submission: Submission;
  onReview: (data: unknown) => void;
}) {
  const [status, setStatus] = useState<"APPROVED" | "DECLINED" | "NEEDS_REVISION">("APPROVED");
  const [feedback, setFeedback] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="default" className="bg-emerald-600 hover:bg-emerald-700">
          Review
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review Submission</DialogTitle>
          <DialogDescription>
            {submission.student?.studentProfile?.fullName || submission.student?.name} - {submission.activity.title}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-gray-50 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold">
              {submission.rawScore} / {submission.activity.maxScore}
            </div>
            <div className="text-center text-gray-500">
              {Math.round((submission.rawScore / submission.activity.maxScore) * 100)}%
            </div>
          </div>
          <div className="space-y-2">
            <Label>Decision</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="APPROVED">Approve</SelectItem>
                <SelectItem value="DECLINED">Decline</SelectItem>
                <SelectItem value="NEEDS_REVISION">Request Revision</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Feedback (optional)</Label>
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Add feedback for the student..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => {
                onReview({ status, teacherFeedback: feedback || null });
                setOpen(false);
              }}
            >
              Submit Review
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Student Record Modal Component
function StudentRecordModal({
  student,
  classId,
  isOpen,
  onClose,
  onReview,
}: {
  student: { id: string; profile: { fullName: string; lrn: string } };
  classId: string;
  isOpen: boolean;
  onClose: () => void;
  onReview: (id: string, data: unknown, type: "score" | "attendance") => void;
}) {
  const [activeTab, setActiveTab] = useState("grades");

  // Fetch class details with all activities
  const { data: classDetails } = useQuery({
    queryKey: ["class", classId],
    queryFn: () => api.get(`/api/classes/${classId}`),
    enabled: isOpen && !!classId,
  });

  // Fetch student's full record
  const { data: studentData, isLoading } = useQuery({
    queryKey: ["studentRecord", classId, student.id],
    queryFn: async () => {
      const exportData = await api.get(`/api/export?classId=${classId}`);
      const studentRecord = exportData.students?.find(
        (s: { studentId: string }) => s.studentId === student.id
      );
      
      // Get all submissions for this student in this class
      const submissions = await api.get(`/api/submissions?studentId=${student.id}&classId=${classId}`);
      
      // Get audit logs
      const auditLogs = await api.get(`/api/audit?studentId=${student.id}`);
      
      // Get attendance data
      const attendanceData = await api.get(`/api/attendance?classId=${classId}`);
      
      // Process attendance sessions to extract student's attendance records
      const attendanceSessions = Array.isArray(attendanceData) ? attendanceData : [];
      const studentAttendance: Array<{
        sessionId: string;
        status: string;
        submissionStatus: string;
      }> = [];
      
      attendanceSessions.forEach((session: {
        id: string;
        date: string;
        title?: string;
        submissions?: Array<{
          studentId: string;
          status: string;
          submissionStatus: string;
        }>;
      }) => {
        const studentSub = session.submissions?.find(
          (sub) => sub.studentId === student.id
        );
        if (studentSub) {
          studentAttendance.push({
            sessionId: session.id,
            status: studentSub.status,
            submissionStatus: studentSub.submissionStatus,
          });
        }
      });
      
      return {
        ...studentRecord,
        allSubmissions: Array.isArray(submissions) ? submissions : [],
        auditLogs: Array.isArray(auditLogs) ? auditLogs : [],
        attendanceSessions,
        attendance: studentAttendance,
      };
    },
    enabled: isOpen && !!student.id && !!classId,
  });

  // Calculate stats
  const stats = {
    grade: studentData?.grade?.transmutedGrade || "--",
    pending: studentData?.allSubmissions?.filter((s: Submission) => s.status === "PENDING").length || 0,
    approved: studentData?.allSubmissions?.filter((s: Submission) => s.status === "APPROVED").length || 0,
    declined: studentData?.allSubmissions?.filter((s: Submission) => s.status === "DECLINED").length || 0,
    needsRevision: studentData?.allSubmissions?.filter((s: Submission) => s.status === "NEEDS_REVISION").length || 0,
  };

  // Create a map of submissions by activityId for easy lookup
  const submissionsMap = new Map<string, Submission>();
  studentData?.allSubmissions?.forEach((s: Submission) => {
    submissionsMap.set(s.activityId, s);
  });

  // Attendance stats
  const attendanceStats = {
    present: studentData?.attendance?.filter((a: { status: string }) => a.status === "PRESENT").length || 0,
    late: studentData?.attendance?.filter((a: { status: string }) => a.status === "LATE").length || 0,
    absent: studentData?.attendance?.filter((a: { status: string }) => a.status === "ABSENT").length || 0,
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl">{student.profile.fullName}</DialogTitle>
              <DialogDescription>LRN: {student.profile.lrn}</DialogDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
              <Card className="p-3 text-center">
                <div className="text-2xl font-bold text-emerald-600">{stats.grade}</div>
                <div className="text-xs text-gray-500">Grade</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{stats.approved}</div>
                <div className="text-xs text-gray-500">Approved</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-2xl font-bold text-amber-600">{stats.pending}</div>
                <div className="text-xs text-gray-500">Pending</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-2xl font-bold text-red-600">{stats.declined}</div>
                <div className="text-xs text-gray-500">Declined</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-2xl font-bold text-orange-600">{stats.needsRevision}</div>
                <div className="text-xs text-gray-500">Revision</div>
              </Card>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="grades">Grades</TabsTrigger>
                <TabsTrigger value="attendance">Attendance</TabsTrigger>
                <TabsTrigger value="audit">Audit Log</TabsTrigger>
              </TabsList>

              <ScrollArea className="flex-1 mt-4">
                {/* Grades Tab */}
                <TabsContent value="grades" className="space-y-4 mt-0">
                  {["WRITTEN_WORK", "PERFORMANCE_TASK", "QUARTERLY_ASSESSMENT"].map((category) => {
                    const activities = classDetails?.activities?.filter((a: Activity) => a.category === category) || [];
                    
                    return (
                      <Card key={category}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            {category === "WRITTEN_WORK" && <FileText className="w-4 h-4" />}
                            {category === "PERFORMANCE_TASK" && <Award className="w-4 h-4" />}
                            {category === "QUARTERLY_ASSESSMENT" && <ClipboardCheck className="w-4 h-4" />}
                            {category.replace("_", " ")}
                            <Badge variant="outline" className="ml-auto">
                              {classDetails?.gradingScheme?.[
                                category === "WRITTEN_WORK" ? "writtenWorksPercent" :
                                category === "PERFORMANCE_TASK" ? "performanceTasksPercent" :
                                "quarterlyAssessmentPercent"
                              ]}%
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {activities.length === 0 ? (
                            <p className="text-sm text-gray-400 py-2">No activities</p>
                          ) : (
                            activities.map((activity: Activity) => {
                              const submission = submissionsMap.get(activity.id);
                              return (
                                <div key={activity.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                                  <div className="flex-1">
                                    <p className="font-medium text-sm">{activity.title}</p>
                                    <p className="text-xs text-gray-500">Max: {activity.maxScore} pts</p>
                                  </div>
                                  {submission ? (
                                    <div className="flex items-center gap-2">
                                      <div className="text-right">
                                        <p className="font-semibold">{submission.rawScore}/{activity.maxScore}</p>
                                        <Badge variant={
                                          submission.status === "APPROVED" ? "default" :
                                          submission.status === "DECLINED" ? "destructive" :
                                          submission.status === "NEEDS_REVISION" ? "secondary" : "outline"
                                        } className="text-xs">
                                          {submission.status.replace("_", " ")}
                                        </Badge>
                                      </div>
                                      {submission.status === "PENDING" && (
                                        <ReviewDialog
                                          submission={submission}
                                          onReview={(data) => onReview(submission.id, data, "score")}
                                        />
                                      )}
                                    </div>
                                  ) : (
                                    <Badge variant="outline" className="text-gray-400">Not submitted</Badge>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </TabsContent>

                {/* Attendance Tab */}
                <TabsContent value="attendance" className="space-y-4 mt-0">
                  <div className="grid grid-cols-3 gap-4">
                    <Card className="p-4 text-center">
                      <div className="text-2xl font-bold text-green-600">{attendanceStats.present}</div>
                      <div className="text-sm text-gray-500">Present</div>
                    </Card>
                    <Card className="p-4 text-center">
                      <div className="text-2xl font-bold text-amber-600">{attendanceStats.late}</div>
                      <div className="text-sm text-gray-500">Late</div>
                    </Card>
                    <Card className="p-4 text-center">
                      <div className="text-2xl font-bold text-red-600">{attendanceStats.absent}</div>
                      <div className="text-sm text-gray-500">Absent</div>
                    </Card>
                  </div>
                  
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Attendance History</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {studentData?.attendanceSessions?.map((session: { id: string; date: string; title?: string }) => {
                          const att = studentData?.attendance?.find(
                            (a: { sessionId: string }) => a.sessionId === session.id
                          );
                          return (
                            <div key={session.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                              <div>
                                <p className="font-medium text-sm">
                                  {session.title || format(new Date(session.date), "MMMM d, yyyy")}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {format(new Date(session.date), "MMM d, yyyy h:mm a")}
                                </p>
                              </div>
                              {att ? (
                                <Badge variant={
                                  att.status === "PRESENT" ? "default" :
                                  att.status === "LATE" ? "secondary" : "destructive"
                                }>
                                  {att.status}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-gray-400">No record</Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Audit Log Tab */}
                <TabsContent value="audit" className="mt-0">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Activity History</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {studentData?.auditLogs?.length === 0 ? (
                          <p className="text-sm text-gray-400 py-4 text-center">No activity recorded</p>
                        ) : (
                          studentData?.auditLogs?.map((log: {
                            id: string;
                            action: string;
                            entityType: string;
                            oldValue?: string;
                            newValue?: string;
                            reason?: string;
                            createdAt: string;
                            user?: { name?: string };
                          }) => (
                            <div key={log.id} className="p-3 bg-gray-50 rounded border-l-4 border-emerald-500">
                              <div className="flex items-center justify-between mb-1">
                                <Badge variant={
                                  log.action === "APPROVED" ? "default" :
                                  log.action === "DECLINED" ? "destructive" :
                                  log.action === "OVERRIDE" ? "secondary" : "outline"
                                }>
                                  {log.action}
                                </Badge>
                                <span className="text-xs text-gray-400">
                                  {format(new Date(log.createdAt), "MMM d, yyyy h:mm a")}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600">
                                {log.entityType} - by {log.user?.name || "System"}
                              </p>
                              {log.reason && (
                                <p className="text-xs text-amber-600 mt-1">
                                  Reason: {log.reason}
                                </p>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Reports Page Component
function ReportsPage({
  classes,
  user,
}: {
  classes: ClassData[];
  user?: { name?: string; email?: string };
}) {
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [reportType, setReportType] = useState<string>("summary");
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [approvedOnly, setApprovedOnly] = useState(true);
  const [includePending, setIncludePending] = useState(false);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [teacherRemarks, setTeacherRemarks] = useState("");
  const [reportRefState, setReportRefState] = useState<HTMLDivElement | null>(null);
  
  // Search and sort state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "grade">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Fetch class details
  const { data: classDetails } = useQuery({
    queryKey: ["class", selectedClassId],
    queryFn: () => api.get(`/api/classes/${selectedClassId}`),
    enabled: !!selectedClassId,
  });

  // Fetch export data for the class
  const { data: exportData, isLoading: isLoadingExport } = useQuery({
    queryKey: ["export", selectedClassId],
    queryFn: () => api.get(`/api/export?classId=${selectedClassId}`),
    enabled: !!selectedClassId && showPreview,
  });

  // Fetch attendance data
  const { data: attendanceData } = useQuery({
    queryKey: ["attendance", selectedClassId],
    queryFn: () => api.get(`/api/attendance?classId=${selectedClassId}`),
    enabled: !!selectedClassId && showPreview,
  });

  // Fetch student submissions if student-based report
  const { data: studentSubmissions } = useQuery({
    queryKey: ["submissions", selectedStudentId, selectedClassId],
    queryFn: () => api.get(`/api/submissions?studentId=${selectedStudentId}&classId=${selectedClassId}`),
    enabled: !!selectedStudentId && !!selectedClassId && showPreview && ["feedback", "progress"].includes(reportType),
  });

  // Fetch audit logs if needed
  const { data: auditLogs } = useQuery({
    queryKey: ["audit", selectedStudentId],
    queryFn: () => api.get(`/api/audit?studentId=${selectedStudentId}`),
    enabled: !!selectedStudentId && showAuditTrail && showPreview,
  });

  const reportTypes = [
    { value: "summary", label: "Class Record (Summary)", isStudentBased: false },
    { value: "detailed", label: "Class Record (Detailed)", isStudentBased: false },
    { value: "feedback", label: "Student Feedback Sheet", isStudentBased: true },
    { value: "progress", label: "Student Progress Report (Detailed)", isStudentBased: true },
  ];

  const selectedReportType = reportTypes.find(r => r.value === reportType);
  const students = exportData?.students || [];
  const selectedStudent = students.find((s: { studentId: string }) => s.studentId === selectedStudentId);

  // Get attendance stats for a student
  const getAttendanceStats = (studentId: string) => {
    if (!attendanceData || !Array.isArray(attendanceData)) return { present: 0, late: 0, absent: 0, total: 0 };
    let present = 0, late = 0, absent = 0;
    attendanceData.forEach((session: { submissions?: Array<{ studentId: string; status: string }> }) => {
      const sub = session.submissions?.find(s => s.studentId === studentId);
      if (sub) {
        if (sub.status === "PRESENT") present++;
        else if (sub.status === "LATE") late++;
        else if (sub.status === "ABSENT") absent++;
      }
    });
    return { present, late, absent, total: present + late + absent };
  };

  // Filter and sort students
  const getFilteredStudents = () => {
    if (!students) return [];
    
    let filtered = students.map((student: {
      studentId: string;
      studentName: string;
      lrn: string;
      grade?: {
        transmutedGrade: number;
        initialGrade: number;
        writtenWorksPercent: number;
        performanceTasksPercent: number;
        quarterlyAssessmentPercent: number;
      };
      submissions?: Array<{
        activityId: string;
        activityTitle: string;
        category: string;
        rawScore: number;
        maxScore: number;
        percentScore: number;
        status: string;
      }>;
    }) => {
      // Filter submissions based on toggle
      const filteredSubs = approvedOnly 
        ? student.submissions?.filter((s: { status: string }) => s.status === "APPROVED")
        : includePending 
          ? student.submissions 
          : student.submissions?.filter((s: { status: string }) => s.status === "APPROVED");
      
      return { ...student, submissions: filteredSubs };
    });

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((s: { studentName: string; lrn: string }) => 
        s.studentName.toLowerCase().includes(query) || 
        s.lrn.toLowerCase().includes(query)
      );
    }

    // Sort
    filtered.sort((a: { studentName: string; grade?: { transmutedGrade: number } }, b: { studentName: string; grade?: { transmutedGrade: number } }) => {
      if (sortBy === "name") {
        const cmp = a.studentName.localeCompare(b.studentName);
        return sortOrder === "asc" ? cmp : -cmp;
      } else {
        const gradeA = a.grade?.transmutedGrade || 0;
        const gradeB = b.grade?.transmutedGrade || 0;
        return sortOrder === "asc" ? gradeA - gradeB : gradeB - gradeA;
      }
    });

    return filtered;
  };

  // Handle print
  const handlePrint = () => {
    if (reportRefState) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Print Report - ${classDetails?.name || "Class Record"}</title>
              <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                @page { size: A4 landscape; margin: 1cm; }
                body { 
                  font-family: 'Segoe UI', Arial, sans-serif; 
                  font-size: 11px; 
                  line-height: 1.3;
                  color: #000;
                  background: #fff;
                }
                .report-container { 
                  width: 100%; 
                  max-width: 100%;
                  padding: 10px;
                }
                .report-header { 
                  text-align: center; 
                  border-bottom: 2px solid #000; 
                  padding-bottom: 12px; 
                  margin-bottom: 15px; 
                }
                .report-header h1 { 
                  font-size: 16px; 
                  font-weight: bold;
                  margin: 0;
                  text-transform: uppercase;
                  letter-spacing: 1px;
                }
                .report-header h2 { 
                  font-size: 13px; 
                  margin: 5px 0;
                  font-weight: 600;
                }
                .report-header .meta { 
                  font-size: 10px; 
                  margin: 3px 0;
                  color: #333;
                }
                .report-header .meta span { margin: 0 10px; }
                
                table { 
                  width: 100%; 
                  border-collapse: collapse; 
                  margin: 10px 0;
                  font-size: 10px;
                }
                thead { display: table-header-group; }
                th, td { 
                  border: 1px solid #000; 
                  padding: 6px 8px; 
                  text-align: left;
                }
                th { 
                  background-color: #f0f0f0; 
                  font-weight: bold;
                  text-align: center;
                  vertical-align: middle;
                }
                td { vertical-align: middle; }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .font-bold { font-weight: bold; }
                
                .badge { 
                  display: inline-block; 
                  padding: 2px 6px; 
                  border-radius: 3px; 
                  font-size: 8px; 
                  font-weight: bold;
                  text-transform: uppercase;
                }
                .badge-pending { background-color: #fef3c7; color: #92400e; border: 1px solid #f59e0b; }
                .badge-approved { background-color: #d1fae5; color: #065f46; border: 1px solid #10b981; }
                .badge-late { background-color: #fef9c3; color: #854d0e; border: 1px solid #eab308; }
                
                .grade-final {
                  font-weight: bold;
                  font-size: 12px;
                }
                .grade-passing { color: #059669; }
                .grade-failing { color: #dc2626; }
                
                .report-footer { 
                  border-top: 1px solid #ccc; 
                  margin-top: 20px; 
                  padding-top: 10px; 
                  text-align: center; 
                  font-size: 9px; 
                  color: #666;
                }
                
                .signature-section { 
                  margin-top: 40px; 
                  display: flex; 
                  justify-content: space-between;
                  padding: 0 20px;
                }
                .signature-box { 
                  width: 200px; 
                  text-align: center; 
                }
                .signature-line { 
                  border-top: 1px solid #000; 
                  margin-top: 50px; 
                  padding-top: 5px;
                  font-size: 10px;
                }
                
                @media print {
                  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                  .page-break { page-break-before: always; }
                  thead { display: table-header-group; }
                  tfoot { display: table-footer-group; }
                }
              </style>
            </head>
            <body>
              ${reportRefState.innerHTML}
            </body>
          </html>
        `);
        printWindow.document.close();
        setTimeout(() => {
          printWindow.print();
        }, 250);
      }
    }
  };

  // Format date
  const formatDate = (date: Date | string) => {
    return format(new Date(date), "MMMM d, yyyy 'at' h:mm a");
  };

  // Toggle sort
  const toggleSort = (field: "name" | "grade") => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Reports / Print Center</h2>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Report Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Select Class */}
            <div className="space-y-2">
              <Label>Select Class</Label>
              <Select value={selectedClassId} onValueChange={(v) => { setSelectedClassId(v); setShowPreview(false); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((cls) => (
                    <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Select Report Type */}
            <div className="space-y-2">
              <Label>Report Type</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose report type" />
                </SelectTrigger>
                <SelectContent>
                  {reportTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Select Student (if student-based) */}
            {selectedReportType?.isStudentBased && (
              <div className="space-y-2">
                <Label>Select Student</Label>
                <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a student" />
                  </SelectTrigger>
                  <SelectContent>
                    {students.map((s: { studentId: string; studentName: string; lrn: string }) => (
                      <SelectItem key={s.studentId} value={s.studentId}>
                        {s.studentName} ({s.lrn})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Toggles */}
          <div className="flex flex-wrap gap-4 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={approvedOnly}
                onChange={(e) => {
                  setApprovedOnly(e.target.checked);
                  if (e.target.checked) setIncludePending(false);
                }}
                className="w-4 h-4 accent-emerald-600"
              />
              <span className="text-sm">Approved only</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includePending}
                onChange={(e) => {
                  setIncludePending(e.target.checked);
                  if (e.target.checked) setApprovedOnly(false);
                }}
                className="w-4 h-4 accent-emerald-600"
              />
              <span className="text-sm">Include pending</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showAuditTrail}
                onChange={(e) => setShowAuditTrail(e.target.checked)}
                className="w-4 h-4 accent-emerald-600"
              />
              <span className="text-sm">Show audit trail</span>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              onClick={() => setShowPreview(true)}
              disabled={!selectedClassId || (selectedReportType?.isStudentBased && !selectedStudentId)}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Eye className="w-4 h-4 mr-2" />
              Preview
            </Button>
            <Button
              onClick={handlePrint}
              disabled={!showPreview}
              variant="outline"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview Area */}
      {showPreview && selectedClassId && (
        <Card>
          <CardContent className="p-4">
            {isLoadingExport ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
              </div>
            ) : (
              <>
                {/* Search and Sort Controls - Only for Summary/Detailed */}
                {(reportType === "summary" || reportType === "detailed") && (
                  <div className="flex flex-wrap gap-4 mb-4 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-[200px]">
                      <Input
                        placeholder="Search by name or LRN..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant={sortBy === "name" ? "default" : "outline"}
                        size="sm"
                        onClick={() => toggleSort("name")}
                        className={sortBy === "name" ? "bg-emerald-600" : ""}
                      >
                        Sort by Name {sortBy === "name" && (sortOrder === "asc" ? "↑" : "↓")}
                      </Button>
                      <Button
                        variant={sortBy === "grade" ? "default" : "outline"}
                        size="sm"
                        onClick={() => toggleSort("grade")}
                        className={sortBy === "grade" ? "bg-emerald-600" : ""}
                      >
                        Sort by Grade {sortBy === "grade" && (sortOrder === "asc" ? "↑" : "↓")}
                      </Button>
                    </div>
                  </div>
                )}

                <div 
                  ref={setReportRefState}
                  className="bg-white max-w-full mx-auto"
                  style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}
                >
                  {/* Report Header */}
                  <div className="text-center border-b-2 border-black pb-3 mb-4">
                    <h1 className="text-lg font-bold uppercase tracking-wide">{classDetails?.name || "Class Record"}</h1>
                    <h2 className="text-sm font-semibold mt-1">{classDetails?.subject || ""} - Section: {classDetails?.section || ""}</h2>
                    <div className="text-xs mt-2 space-x-4">
                      <span>School Year: <strong>{classDetails?.schoolYear || "N/A"}</strong></span>
                      <span>Quarter: <strong>{classDetails?.quarter || "N/A"}</strong></span>
                    </div>
                    <div className="text-xs mt-1">
                      <span>Teacher: <strong>{user?.name || classDetails?.owner?.name || classDetails?.owner?.email?.split('@')[0] || "N/A"}</strong></span>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Generated: {formatDate(new Date())}
                    </p>
                  </div>

                  {/* Class Summary Report */}
                  {reportType === "summary" && (
                    <>
                      <h3 className="text-sm font-bold mb-3 uppercase">Class Record Summary</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse border border-black text-xs">
                          <thead>
                            <tr className="bg-gray-200">
                              <th className="border border-black px-2 py-2 text-center w-10">#</th>
                              <th className="border border-black px-2 py-2 text-left">LRN</th>
                              <th className="border border-black px-2 py-2 text-left">Student Name</th>
                              <th className="border border-black px-2 py-2 text-center">WW %</th>
                              <th className="border border-black px-2 py-2 text-center">PT %</th>
                              <th className="border border-black px-2 py-2 text-center">QA %</th>
                              <th className="border border-black px-2 py-2 text-center">Initial</th>
                              <th className="border border-black px-2 py-2 text-center font-bold">Final Grade</th>
                              <th className="border border-black px-2 py-2 text-center">Attendance</th>
                              <th className="border border-black px-2 py-2 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {getFilteredStudents().map((student: {
                              studentId: string;
                              studentName: string;
                              lrn: string;
                              grade?: {
                                transmutedGrade: number;
                                initialGrade: number;
                                writtenWorksPercent: number;
                                performanceTasksPercent: number;
                                quarterlyAssessmentPercent: number;
                              };
                              submissions?: Array<{ status: string }>;
                            }, index: number) => {
                              const attStats = getAttendanceStats(student.studentId);
                              const hasPending = student.submissions?.some(s => s.status === "PENDING") && includePending;
                              const finalGrade = student.grade?.transmutedGrade || "--";
                              const isPassing = typeof finalGrade === "number" && finalGrade >= 75;
                              
                              return (
                                <tr key={student.studentId || `row-${index}`} className="hover:bg-gray-50">
                                  <td className="border border-black px-2 py-2 text-center">{index + 1}</td>
                                  <td className="border border-black px-2 py-2">{student.lrn}</td>
                                  <td className="border border-black px-2 py-2 font-medium">{student.studentName}</td>
                                  <td className="border border-black px-2 py-2 text-center">
                                    {student.grade?.writtenWorksPercent?.toFixed(1) || "-"}
                                  </td>
                                  <td className="border border-black px-2 py-2 text-center">
                                    {student.grade?.performanceTasksPercent?.toFixed(1) || "-"}
                                  </td>
                                  <td className="border border-black px-2 py-2 text-center">
                                    {student.grade?.quarterlyAssessmentPercent?.toFixed(1) || "-"}
                                  </td>
                                  <td className="border border-black px-2 py-2 text-center">
                                    {student.grade?.initialGrade?.toFixed(2) || "-"}
                                  </td>
                                  <td className="border border-black px-2 py-2 text-center">
                                    <span className={`font-bold text-sm ${isPassing ? "text-green-700" : "text-red-700"}`}>
                                      {finalGrade}
                                    </span>
                                  </td>
                                  <td className="border border-black px-2 py-2 text-center text-xs">
                                    <span className="text-green-600">P:{attStats.present}</span>
                                    <span className="text-amber-600 ml-1">L:{attStats.late}</span>
                                    <span className="text-red-600 ml-1">A:{attStats.absent}</span>
                                  </td>
                                  <td className="border border-black px-2 py-2 text-center">
                                    {hasPending ? (
                                      <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded border border-amber-300">
                                        Pending
                                      </span>
                                    ) : (
                                      <span className="inline-block px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded border border-green-300">
                                        Complete
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      
                      {/* Summary Stats */}
                      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="border p-2 rounded text-center">
                          <p className="text-gray-500">Total Students</p>
                          <p className="font-bold text-lg">{getFilteredStudents().length}</p>
                        </div>
                        <div className="border p-2 rounded text-center">
                          <p className="text-gray-500">Class Average</p>
                          <p className="font-bold text-lg">
                            {(() => {
                              const grades = getFilteredStudents()
                                .map((s: { grade?: { transmutedGrade: number } }) => s.grade?.transmutedGrade)
                                .filter((g): g is number => typeof g === "number");
                              return grades.length > 0 
                                ? (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(1)
                                : "--";
                            })()}
                          </p>
                        </div>
                        <div className="border p-2 rounded text-center">
                          <p className="text-gray-500">Passing</p>
                          <p className="font-bold text-lg text-green-600">
                            {getFilteredStudents().filter((s: { grade?: { transmutedGrade: number } }) => 
                              (s.grade?.transmutedGrade || 0) >= 75
                            ).length}
                          </p>
                        </div>
                        <div className="border p-2 rounded text-center">
                          <p className="text-gray-500">At Risk</p>
                          <p className="font-bold text-lg text-red-600">
                            {getFilteredStudents().filter((s: { grade?: { transmutedGrade: number } }) => 
                              (s.grade?.transmutedGrade || 0) < 75
                            ).length}
                          </p>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Detailed Class Record */}
                  {reportType === "detailed" && (
                    <>
                      <h3 className="text-sm font-bold mb-3 uppercase">Class Record (Detailed)</h3>
                      {getFilteredStudents().map((student: {
                        studentId: string;
                        studentName: string;
                        lrn: string;
                        grade?: { transmutedGrade: number; initialGrade: number };
                        submissions?: Array<{
                          activityId: string;
                          activityTitle: string;
                          category: string;
                          rawScore: number;
                          maxScore: number;
                          status: string;
                        }>;
                      }, index: number) => (
                        <div key={student.studentId || `student-${index}`} className="mb-4 page-break-inside-avoid">
                          <div className="bg-gray-100 p-2 border border-black flex justify-between items-center">
                            <div>
                              <span className="font-bold">{index + 1}. {student.studentName}</span>
                              <span className="text-xs ml-3 text-gray-600">LRN: {student.lrn}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-xs text-gray-500">Initial: {student.grade?.initialGrade?.toFixed(2) || "-"}</span>
                              <span className="ml-3 font-bold">Final: {student.grade?.transmutedGrade || "-"}</span>
                            </div>
                          </div>
                          <table className="w-full border-collapse border border-black text-xs">
                            <thead>
                              <tr className="bg-gray-50">
                                <th className="border border-black px-2 py-1 text-left">Activity</th>
                                <th className="border border-black px-2 py-1 text-center w-20">Category</th>
                                <th className="border border-black px-2 py-1 text-center w-16">Score</th>
                                <th className="border border-black px-2 py-1 text-center w-16">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {student.submissions?.map((sub) => (
                                <tr key={sub.activityId}>
                                  <td className="border border-black px-2 py-1">{sub.activityTitle}</td>
                                  <td className="border border-black px-2 py-1 text-center text-xs">{sub.category.replace("_", " ")}</td>
                                  <td className="border border-black px-2 py-1 text-center">{sub.rawScore}/{sub.maxScore}</td>
                                  <td className="border border-black px-2 py-1 text-center">
                                    <span className={`inline-block px-1 py-0.5 text-xs rounded ${
                                      sub.status === "APPROVED" ? "bg-green-100 text-green-800" :
                                      sub.status === "PENDING" ? "bg-amber-100 text-amber-800" :
                                      "bg-red-100 text-red-800"
                                    }`}>
                                      {sub.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                              {(!student.submissions || student.submissions.length === 0) && (
                                <tr>
                                  <td colSpan={4} className="border border-black px-2 py-2 text-center text-gray-400 italic">
                                    No submissions
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Student Feedback Sheet */}
                  {reportType === "feedback" && selectedStudent && (
                    <>
                      <h3 className="text-sm font-bold mb-3 uppercase">Student Feedback Sheet</h3>
                      <div className="mb-4 p-3 bg-gray-50 rounded border">
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <p><strong>Student Name:</strong> {selectedStudent.studentName}</p>
                          <p><strong>LRN:</strong> {selectedStudent.lrn}</p>
                          <p><strong>Class:</strong> {classDetails?.name}</p>
                          <p><strong>Quarter:</strong> {classDetails?.quarter}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-3 mb-4">
                        <div className="border p-3 text-center rounded">
                          <p className="text-2xl font-bold text-emerald-600">{selectedStudent.grade?.transmutedGrade || "-"}</p>
                          <p className="text-xs text-gray-500">Final Grade</p>
                        </div>
                        <div className="border p-3 text-center rounded">
                          <p className="text-xl font-bold">{selectedStudent.grade?.writtenWorksPercent?.toFixed(1) || "0"}%</p>
                          <p className="text-xs text-gray-500">Written Works</p>
                        </div>
                        <div className="border p-3 text-center rounded">
                          <p className="text-xl font-bold">{selectedStudent.grade?.performanceTasksPercent?.toFixed(1) || "0"}%</p>
                          <p className="text-xs text-gray-500">Performance Tasks</p>
                        </div>
                        <div className="border p-3 text-center rounded">
                          <p className="text-xl font-bold">{selectedStudent.grade?.quarterlyAssessmentPercent?.toFixed(1) || "0"}%</p>
                          <p className="text-xs text-gray-500">Quarterly Assessment</p>
                        </div>
                      </div>

                      <h4 className="font-semibold mb-2 text-sm">Submissions:</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse border border-black text-xs mb-4">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="border border-black px-2 py-1 text-left">Activity</th>
                              <th className="border border-black px-2 py-1 text-center">Category</th>
                              <th className="border border-black px-2 py-1 text-center">Score</th>
                              <th className="border border-black px-2 py-1 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedStudent.submissions?.map((sub: {
                              activityId: string;
                              activityTitle: string;
                              category: string;
                              rawScore: number;
                              maxScore: number;
                              status: string;
                            }) => (
                              <tr key={sub.activityId}>
                                <td className="border border-black px-2 py-1">{sub.activityTitle}</td>
                                <td className="border border-black px-2 py-1 text-center">{sub.category.replace("_", " ")}</td>
                                <td className="border border-black px-2 py-1 text-center">{sub.rawScore}/{sub.maxScore}</td>
                                <td className="border border-black px-2 py-1 text-center">
                                  <span className={`inline-block px-1 py-0.5 text-xs rounded ${
                                    sub.status === "APPROVED" ? "bg-green-100 text-green-800" :
                                    sub.status === "PENDING" ? "bg-amber-100 text-amber-800" :
                                    "bg-red-100 text-red-800"
                                  }`}>
                                    {sub.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Teacher Remarks */}
                      <h4 className="font-semibold mb-2 text-sm">Teacher Remarks:</h4>
                      <textarea
                        className="w-full border border-black p-2 min-h-[80px] mb-4 text-sm"
                        placeholder="Enter teacher remarks here..."
                        value={teacherRemarks}
                        onChange={(e) => setTeacherRemarks(e.target.value)}
                      />

                      {/* Attendance Summary */}
                      <h4 className="font-semibold mb-2 text-sm">Attendance Summary:</h4>
                      <div className="flex gap-6 mb-6 text-sm">
                        <span className="text-green-600 font-medium">Present: {getAttendanceStats(selectedStudentId).present}</span>
                        <span className="text-amber-600 font-medium">Late: {getAttendanceStats(selectedStudentId).late}</span>
                        <span className="text-red-600 font-medium">Absent: {getAttendanceStats(selectedStudentId).absent}</span>
                      </div>

                      {/* Signature Lines */}
                      <div className="flex justify-between mt-12 pt-4">
                        <div className="text-center w-40">
                          <div className="border-t border-black pt-2 mt-10">
                            <p className="text-xs">Teacher's Signature</p>
                          </div>
                        </div>
                        <div className="text-center w-40">
                          <div className="border-t border-black pt-2 mt-10">
                            <p className="text-xs">Parent/Guardian's Signature</p>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Student Progress Report */}
                  {reportType === "progress" && selectedStudent && (
                    <>
                      <h3 className="text-sm font-bold mb-3 uppercase">Student Progress Report (Detailed)</h3>
                      
                      {/* Student Info */}
                      <div className="mb-4 p-3 bg-gray-50 rounded border">
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <p><strong>Student Name:</strong> {selectedStudent.studentName}</p>
                          <p><strong>LRN:</strong> {selectedStudent.lrn}</p>
                          <p><strong>Class:</strong> {classDetails?.name}</p>
                          <p><strong>Subject:</strong> {classDetails?.subject}</p>
                          <p><strong>Quarter:</strong> {classDetails?.quarter}</p>
                          <p><strong>School Year:</strong> {classDetails?.schoolYear}</p>
                        </div>
                      </div>

                      {/* Grade Breakdown */}
                      <h4 className="font-semibold mb-2 text-sm">Grade Breakdown</h4>
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="border p-3 rounded">
                          <p className="text-xs text-gray-500">Written Works ({classDetails?.gradingScheme?.writtenWorksPercent}%)</p>
                          <p className="text-lg font-bold">{selectedStudent.grade?.writtenWorksPercent?.toFixed(1) || "0"}%</p>
                        </div>
                        <div className="border p-3 rounded">
                          <p className="text-xs text-gray-500">Performance Tasks ({classDetails?.gradingScheme?.performanceTasksPercent}%)</p>
                          <p className="text-lg font-bold">{selectedStudent.grade?.performanceTasksPercent?.toFixed(1) || "0"}%</p>
                        </div>
                        <div className="border p-3 rounded">
                          <p className="text-xs text-gray-500">Quarterly Assessment ({classDetails?.gradingScheme?.quarterlyAssessmentPercent}%)</p>
                          <p className="text-lg font-bold">{selectedStudent.grade?.quarterlyAssessmentPercent?.toFixed(1) || "0"}%</p>
                        </div>
                      </div>

                      {/* Detailed Submissions by Category */}
                      {["WRITTEN_WORK", "PERFORMANCE_TASK", "QUARTERLY_ASSESSMENT"].map(category => (
                        <div key={category} className="mb-4">
                          <h4 className="font-semibold mb-2 text-sm">{category.replace("_", " ")}</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse border border-black text-xs">
                              <thead>
                                <tr className="bg-gray-100">
                                  <th className="border border-black px-2 py-1 text-left">Activity</th>
                                  <th className="border border-black px-2 py-1 text-center">Max</th>
                                  <th className="border border-black px-2 py-1 text-center">Score</th>
                                  <th className="border border-black px-2 py-1 text-center">%</th>
                                  <th className="border border-black px-2 py-1 text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedStudent.submissions?.filter((s: { category: string }) => s.category === category).map((sub: {
                                  activityId: string;
                                  activityTitle: string;
                                  rawScore: number;
                                  maxScore: number;
                                  percentScore: number;
                                  status: string;
                                }) => (
                                  <tr key={sub.activityId}>
                                    <td className="border border-black px-2 py-1">{sub.activityTitle}</td>
                                    <td className="border border-black px-2 py-1 text-center">{sub.maxScore}</td>
                                    <td className="border border-black px-2 py-1 text-center">{sub.rawScore}</td>
                                    <td className="border border-black px-2 py-1 text-center">{sub.percentScore?.toFixed(1)}%</td>
                                    <td className="border border-black px-2 py-1 text-center">
                                      <span className={`inline-block px-1 py-0.5 text-xs rounded ${
                                        sub.status === "APPROVED" ? "bg-green-100 text-green-800" :
                                        sub.status === "PENDING" ? "bg-amber-100 text-amber-800" :
                                        "bg-red-100 text-red-800"
                                      }`}>
                                        {sub.status}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}

                      {/* Missing Submissions */}
                      {(() => {
                        const activityIds = new Set(selectedStudent.submissions?.map((s: { activityId: string }) => s.activityId) || []);
                        const missingActivities = classDetails?.activities?.filter((a: { id: string }) => !activityIds.has(a.id)) || [];
                        if (missingActivities.length > 0) {
                          return (
                            <div className="mb-4">
                              <h4 className="font-semibold mb-2 text-sm text-amber-600">Missing Submissions ({missingActivities.length})</h4>
                              <ul className="list-disc list-inside text-sm">
                                {missingActivities.map((a: { id: string; title: string; category: string }) => (
                                  <li key={a.id}>{a.title} ({a.category.replace("_", " ")})</li>
                                ))}
                              </ul>
                            </div>
                          );
                        }
                        return null;
                      })()}

                      {/* Attendance */}
                      <h4 className="font-semibold mb-2 text-sm">Attendance Record</h4>
                      <div className="flex gap-6 mb-4 text-sm">
                        <span className="text-green-600 font-medium">Present: {getAttendanceStats(selectedStudentId).present}</span>
                        <span className="text-amber-600 font-medium">Late: {getAttendanceStats(selectedStudentId).late}</span>
                        <span className="text-red-600 font-medium">Absent: {getAttendanceStats(selectedStudentId).absent}</span>
                      </div>

                      {/* Teacher Remarks */}
                      <h4 className="font-semibold mb-2 text-sm">Teacher Remarks:</h4>
                      <textarea
                        className="w-full border border-black p-2 min-h-[80px] mb-4 text-sm"
                        placeholder="Enter teacher remarks here..."
                        value={teacherRemarks}
                        onChange={(e) => setTeacherRemarks(e.target.value)}
                      />

                      {/* Final Grade */}
                      <div className="text-center p-4 bg-emerald-50 rounded-lg border border-emerald-200 mb-4">
                        <p className="text-xs text-gray-500">Final Grade</p>
                        <p className="text-3xl font-bold text-emerald-600">{selectedStudent.grade?.transmutedGrade || "-"}</p>
                      </div>

                      {/* Signature Lines */}
                      <div className="flex justify-between mt-10 pt-4">
                        <div className="text-center w-40">
                          <div className="border-t border-black pt-2 mt-10">
                            <p className="text-xs">Teacher's Signature</p>
                          </div>
                        </div>
                        <div className="text-center w-40">
                          <div className="border-t border-black pt-2 mt-10">
                            <p className="text-xs">Parent/Guardian's Signature</p>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Audit Trail */}
                  {showAuditTrail && auditLogs && auditLogs.length > 0 && (
                    <div className="mt-6 pt-4 border-t">
                      <h4 className="font-semibold mb-2 text-sm">Audit Trail</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse border border-black text-xs">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="border border-black px-2 py-1 text-left">Date/Time</th>
                              <th className="border border-black px-2 py-1 text-left">Action</th>
                              <th className="border border-black px-2 py-1 text-left">User</th>
                              <th className="border border-black px-2 py-1 text-left">Details</th>
                            </tr>
                          </thead>
                          <tbody>
                            {auditLogs.map((log: {
                              id: string;
                              action: string;
                              entityType: string;
                              createdAt: string;
                              user?: { name?: string };
                            }) => (
                              <tr key={log.id}>
                                <td className="border border-black px-2 py-1">{format(new Date(log.createdAt), "MMM d, yyyy h:mm a")}</td>
                                <td className="border border-black px-2 py-1">{log.action}</td>
                                <td className="border border-black px-2 py-1">{log.user?.name || "System"}</td>
                                <td className="border border-black px-2 py-1">{log.entityType}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Report Footer */}
                  <div className="border-t border-gray-300 mt-6 pt-3 text-center text-xs text-gray-500">
                    <p>Generated by Accountability Class Record System | {formatDate(new Date())}</p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Overall Standing Page Component
function OverallStandingPage({
  classes,
  user,
  onSelectClass,
}: {
  classes: ClassData[];
  user?: { id?: string; name?: string; studentProfile?: { fullName: string; lrn: string } };
  onSelectClass: (cls: ClassData) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "grade" | "pending">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Fetch all class grades using the unified API
  const { data: allClassData, isLoading } = useQuery({
    queryKey: ["overallStanding", classes.map((c: ClassData) => c.id).join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        classes.map(async (cls: ClassData) => {
          // Use the unified grades API
          const gradesData = await api.get(`/api/grades?classId=${cls.id}`);
          const grades = gradesData?.grades;
          
          // Determine missing categories based on computed grades
          const missingCategories: string[] = [];
          if (grades?.ww?.count === 0) missingCategories.push("WW");
          if (grades?.pt?.count === 0) missingCategories.push("PT");
          if (grades?.qa?.count === 0) missingCategories.push("QA");

          return {
            class: cls,
            classDetails: gradesData?.classInfo,
            gradingPeriodStatus: gradesData?.classInfo?.gradingPeriodStatus || "OPEN",
            currentGrade: grades?.currentGrade || null,
            tentativeGrade: grades?.tentativeGrade || null,
            isEligibleForTentative: grades?.isEligibleForTentative || false,
            isSynced: grades?.isSynced || false,
            missingCategories,
            pendingCount: grades?.pendingCount || 0,
            needsRevisionCount: grades?.needsRevisionCount || 0,
          };
        })
      );
      return results;
    },
    enabled: classes.length > 0,
  });

  // Filter and sort
  const processedData = (() => {
    if (!allClassData) return [];
    
    let filtered = allClassData;
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((item: { class: { name: string; section: string } }) => 
        item.class.name.toLowerCase().includes(query) ||
        item.class.section.toLowerCase().includes(query)
      );
    }
    
    // Sort
    filtered.sort((a: { class: { name: string }; currentGrade: number | null; tentativeGrade: number | null; pendingCount: number }, b: { class: { name: string }; currentGrade: number | null; tentativeGrade: number | null; pendingCount: number }) => {
      let cmp = 0;
      if (sortBy === "name") {
        cmp = a.class.name.localeCompare(b.class.name);
      } else if (sortBy === "grade") {
        const gradeA = a.currentGrade || a.tentativeGrade || 0;
        const gradeB = b.currentGrade || b.tentativeGrade || 0;
        cmp = gradeA - gradeB;
      } else {
        cmp = a.pendingCount - b.pendingCount;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
    
    return filtered;
  })();

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Overall Standing</h2>
      
      {/* Search and Sort Controls */}
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search by class name or section..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 min-w-[200px]"
        />
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Class Name</SelectItem>
            <SelectItem value="grade">Grade</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
          title={sortOrder === "asc" ? "Ascending" : "Descending"}
        >
          {sortOrder === "asc" ? "↑" : "↓"}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="w-6 h-6 animate-spin text-teal-600" />
        </div>
      ) : processedData.length === 0 ? (
        <Card className="p-8 text-center">
          <BookOpen className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium mb-2">No Classes Found</h3>
          <p className="text-gray-500">Join a class to see your overall standing</p>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border px-4 py-3 text-left">Class/Section</th>
                <th className="border px-4 py-3 text-center">Quarter</th>
                <th className="border px-4 py-3 text-center">Status</th>
                <th className="border px-4 py-3 text-center">Tentative Grade</th>
                <th className="border px-4 py-3 text-center">Missing Categories</th>
                <th className="border px-4 py-3 text-center">Pending</th>
              </tr>
            </thead>
            <tbody>
              {processedData.map((item: {
                class: ClassData;
                classDetails?: { quarter: number };
                gradingPeriodStatus: "OPEN" | "COMPLETED";
                currentGrade: number | null;
                tentativeGrade: number | null;
                isEligibleForTentative: boolean;
                isSynced: boolean;
                missingCategories: string[];
                pendingCount: number;
                needsRevisionCount: number;
              }) => (
                <tr 
                  key={item.class.id} 
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => onSelectClass(item.class)}
                >
                  <td className="border px-4 py-3">
                    <div>
                      <p className="font-medium">{item.class.name}</p>
                      <p className="text-xs text-gray-500">{item.class.section}</p>
                    </div>
                  </td>
                  <td className="border px-4 py-3 text-center">Q{item.classDetails?.quarter || item.class.quarter}</td>
                  <td className="border px-4 py-3 text-center">
                    {item.gradingPeriodStatus === "COMPLETED" ? (
                      <div className="space-y-1">
                        <Badge className="bg-green-600">Completed</Badge>
                        {item.currentGrade && (
                          <p className={`text-lg font-bold ${item.currentGrade >= 75 ? "text-green-600" : "text-red-600"}`}>
                            {item.currentGrade}
                          </p>
                        )}
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-amber-600 border-amber-300">Open</Badge>
                    )}
                  </td>
                  <td className="border px-4 py-3 text-center">
                    {item.gradingPeriodStatus === "COMPLETED" ? (
                      <span className="text-xs text-gray-400">Finalized</span>
                    ) : item.isEligibleForTentative ? (
                      <div className="flex items-center justify-center gap-2">
                        <span className={`font-bold ${item.isSynced ? "text-green-600" : "text-amber-600"}`}>
                          {item.tentativeGrade}
                        </span>
                        {item.isSynced && (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-300">Synced</Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">Not eligible</span>
                    )}
                  </td>
                  <td className="border px-4 py-3 text-center">
                    {item.missingCategories.length > 0 ? (
                      <div className="flex gap-1 justify-center flex-wrap">
                        {item.missingCategories.map((cat: string) => (
                          <Badge key={cat} variant="outline" className="text-red-600 border-red-300 text-xs">
                            {cat}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-green-600 text-xs">All covered ✓</span>
                    )}
                  </td>
                  <td className="border px-4 py-3 text-center">
                    {item.pendingCount > 0 ? (
                      <Badge variant="outline" className="text-amber-600 border-amber-300">
                        {item.pendingCount}
                      </Badge>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {/* Legend */}
      <Card className="p-4 bg-gray-50">
        <div className="flex flex-wrap gap-4 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <Badge className="bg-green-600 text-xs">Completed</Badge>
            <span>Grading period finalized - shows Current Grade</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">Open</Badge>
            <span>Grading period ongoing - shows Tentative Grade only</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs text-green-600 border-green-300">Synced</Badge>
            <span>Tentative = Current when no pending submissions</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

// Student Dashboard
function StudentDashboard({ goLanding }: { goLanding: () => void }) {
  const [activeTab, setActiveTab] = useState("standing");
  const [showJoinClass, setShowJoinClass] = useState(false);
  const [selectedClass, setSelectedClass] = useState<ClassData | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  
  // My Standing tab filters
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<"dueDate" | "status" | "title">("dueDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [submitActivity, setSubmitActivity] = useState<Activity | null>(null);
  
  const queryClient = useQueryClient();

  // Queries
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/api/me"),
  });

  const { data: classes = [] } = useQuery({
    queryKey: ["classes"],
    queryFn: () => api.get("/api/classes"),
  });

  const { data: submissions = [] } = useQuery({
    queryKey: ["submissions"],
    queryFn: () => api.get("/api/submissions"),
  });

  const { data: classDetails } = useQuery({
    queryKey: ["class", selectedClass?.id],
    queryFn: () => api.get(`/api/classes/${selectedClass?.id}`),
    enabled: !!selectedClass,
  });

  // New grades query using the unified API
  const { data: gradesData, isLoading: gradesLoading } = useQuery({
    queryKey: ["studentGrades", selectedClass?.id],
    queryFn: () => api.get(`/api/grades?classId=${selectedClass?.id}`),
    enabled: !!selectedClass,
  });

  // Notifications query
  const { data: notificationsData, isLoading: notificationsLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get("/api/notifications"),
  });

  // Mark notification as read mutation
  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // Mark all as read mutation
  const markAllReadMutation = useMutation({
    mutationFn: () => api.post("/api/notifications/read-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // Join class mutation
  const joinClassMutation = useMutation({
    mutationFn: (code: string) => api.post("/api/classes/join", { code }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      setShowJoinClass(false);
      toast.success("Successfully joined class!");
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Submit score mutation
  const submitMutation = useMutation({
    mutationFn: (data: unknown) => api.post("/api/submissions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["submissions"] });
      toast.success("Score submitted!");
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Submit attendance mutation
  const submitAttendanceMutation = useMutation({
    mutationFn: (data: { sessionId: string; status: string; qrToken?: string }) => api.post(`/api/attendance/${data.sessionId}`, data),
    onSuccess: () => {
      toast.success("Attendance recorded!");
    },
    onError: (error: unknown) => toast.error((error as Error).message),
  });

  // Stats
  const stats = {
    totalClasses: classes.length,
    pendingSubmissions: submissions.filter((s: Submission) => s.status === "PENDING").length,
    approvedSubmissions: submissions.filter((s: Submission) => s.status === "APPROVED").length,
    needsRevision: submissions.filter((s: Submission) => s.status === "NEEDS_REVISION" || s.status === "DECLINED").length,
  };

  // Get computed grades from the new API
  const computedGrades = gradesData?.grades;
  
  // Find missing submissions for selected class
  const missingSubmissions = selectedClass && classDetails 
    ? (classDetails.activities || []).filter((a: Activity) => 
        !submissions.some((s: Submission) => s.activityId === a.id && s.status !== "DECLINED")
      )
    : [];

  // Handle QR scan
  const handleQRScan = useCallback((token: string) => {
    // Find the attendance session with this token
    classes.forEach((cls: ClassData) => {
      cls.attendanceSessions?.forEach((session) => {
        if (session.qrToken === token) {
          submitAttendanceMutation.mutate({
            sessionId: session.id,
            status: "PRESENT",
            qrToken: token,
          });
        }
      });
    });
  }, [classes, submitAttendanceMutation]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-teal-600 text-white sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-white hover:bg-teal-700"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            <User className="w-6 h-6" />
            <div>
              <h1 className="text-lg font-semibold">
                {user?.studentProfile?.fullName || user?.name || "Student"}
              </h1>
              {user?.studentProfile?.lrn && (
                <p className="text-xs text-teal-200">LRN: {user.studentProfile.lrn}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Notifications Bell */}
            <div className="relative">
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-white hover:bg-teal-700"
                onClick={() => setShowNotifications(!showNotifications)}
              >
                <Bell className="w-5 h-5" />
                {notificationsData?.unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {notificationsData.unreadCount > 9 ? '9+' : notificationsData.unreadCount}
                  </span>
                )}
              </Button>
              
              {/* Notifications Dropdown */}
              {showNotifications && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-lg shadow-lg border z-50 max-h-96 overflow-hidden">
                  <div className="p-3 border-b flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">Notifications</h3>
                    {notificationsData?.unreadCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-teal-600"
                        onClick={() => markAllReadMutation.mutate()}
                      >
                        Mark all read
                      </Button>
                    )}
                  </div>
                  <ScrollArea className="max-h-72">
                    {notificationsLoading ? (
                      <div className="p-4 text-center text-gray-500">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
                      </div>
                    ) : !notificationsData?.notifications?.length ? (
                      <div className="p-4 text-center text-gray-500">
                        No notifications
                      </div>
                    ) : (
                      <div className="divide-y">
                        {notificationsData.notifications.map((notification: {
                          id: string;
                          title: string;
                          message: string;
                          isRead: boolean;
                          createdAt: string;
                          type: string;
                          fromUser?: { name: string };
                        }) => (
                          <div
                            key={notification.id}
                            className={`p-3 cursor-pointer hover:bg-gray-50 ${
                              !notification.isRead ? 'bg-teal-50' : ''
                            }`}
                            onClick={() => markReadMutation.mutate(notification.id)}
                          >
                            <div className="flex items-start gap-2">
                              {!notification.isRead && (
                                <div className="w-2 h-2 bg-teal-500 rounded-full mt-2 flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm ${!notification.isRead ? 'font-semibold' : ''}`}>
                                  {notification.title}
                                </p>
                                <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                                  {notification.message}
                                </p>
                                <p className="text-xs text-gray-400 mt-1">
                                  {new Date(notification.createdAt).toLocaleDateString('en-PH', {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              )}
            </div>
            
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-white hover:bg-teal-700"
              onClick={() => setShowQRScanner(true)}
            >
              <Scan className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-teal-700"
              onClick={goLanding}
              title="Home"
            >
              <Home className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-teal-700"
              onClick={() => setShowLogoutConfirm(true)}
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar */}
        <aside className={`
          fixed lg:static inset-y-0 left-0 z-40 w-64 bg-white border-r transform transition-transform lg:transform-none
          ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
          pt-16 lg:pt-0
        `}>
          <div className="p-4 space-y-4">
            {/* Navigation */}
            <nav className="space-y-1">
              <Button
                variant={activeTab === "overall" ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => { setActiveTab("overall"); setMobileMenuOpen(false); }}
              >
                <BarChart3 className="w-4 h-4" />
                Overall Standing
              </Button>
              <Button
                variant={activeTab === "standing" ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => { setActiveTab("standing"); setMobileMenuOpen(false); }}
              >
                <TrendingUp className="w-4 h-4" />
                My Standing
              </Button>
              <Button
                variant={activeTab === "pending" ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => { setActiveTab("pending"); setMobileMenuOpen(false); }}
              >
                <Clock className="w-4 h-4" />
                Pending Items
                {stats.needsRevision > 0 && (
                  <Badge variant="destructive" className="ml-auto">{stats.needsRevision}</Badge>
                )}
              </Button>
              <Button
                variant={activeTab === "missing" ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => { setActiveTab("missing"); setMobileMenuOpen(false); }}
              >
                <ListChecks className="w-4 h-4" />
                Missing Submissions
              </Button>
              <Button
                variant={activeTab === "classes" ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => { setActiveTab("classes"); setMobileMenuOpen(false); }}
              >
                <BookOpen className="w-4 h-4" />
                My Classes
              </Button>
            </nav>

            <Separator />

            {/* Class List */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-500">Classes</span>
                <Button size="sm" variant="ghost" onClick={() => setShowJoinClass(true)}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <ScrollArea className="h-48">
                <div className="space-y-1">
                  {classes.map((cls: ClassData) => (
                    <Button
                      key={cls.id}
                      variant={selectedClass?.id === cls.id ? "secondary" : "ghost"}
                      className="w-full justify-start text-sm"
                      onClick={() => {
                        setSelectedClass(cls);
                        setActiveTab("class");
                        setMobileMenuOpen(false);
                      }}
                    >
                      <span className="truncate flex items-center gap-2">
                        {cls.name}
                        <Badge className={`
                          text-[10px] px-1
                          ${cls.quarter === 1 ? "bg-emerald-600" : ""}
                          ${cls.quarter === 2 ? "bg-blue-600" : ""}
                          ${cls.quarter === 3 ? "bg-amber-600" : ""}
                          ${cls.quarter === 4 ? "bg-purple-600" : ""}
                        `}>
                          Q{cls.quarter}
                        </Badge>
                      </span>
                      <ChevronRight className="w-4 h-4 ml-auto" />
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {/* Overall Standing Tab */}
          {activeTab === "overall" && (
            <OverallStandingPage
              classes={classes}
              user={user}
              onSelectClass={(cls) => {
                setSelectedClass(cls);
                setActiveTab("standing");
              }}
            />
          )}

          {/* Standing Tab */}
          {activeTab === "standing" && selectedClass && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">My Standing - {selectedClass.name}</h2>

              {gradesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 animate-spin text-teal-600" />
                </div>
              ) : computedGrades ? (
                <>
                  {/* Grading Period Status Banner */}
                  {gradesData?.classInfo?.gradingPeriodStatus === "OPEN" && (
                    <Card className="bg-amber-50 border-amber-200">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 text-amber-700">
                          <Clock className="w-5 h-5" />
                          <span className="text-sm font-medium">Grading period is still open</span>
                        </div>
                        <p className="text-xs text-amber-600 mt-1">
                          Your current grade will be visible once the teacher marks the grading period as complete.
                        </p>
                      </CardContent>
                    </Card>
                  )}
                  
                  {/* Grade Summary Cards */}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {/* Current Grade (Approved-only) - Only show if COMPLETED */}
                    {gradesData?.classInfo?.gradingPeriodStatus === "COMPLETED" ? (
                      <Card className="bg-gradient-to-br from-teal-500 to-emerald-600 text-white">
                        <CardContent className="pt-4">
                          <p className="text-sm opacity-80">Current Grade (Final)</p>
                          <p className="text-3xl font-bold">{computedGrades.currentGrade || "--"}</p>
                          <p className="text-xs opacity-70 mt-1">Initial: {computedGrades.initialGrade?.toFixed(2) || "--"}</p>
                        </CardContent>
                      </Card>
                    ) : (
                      <Card className="bg-gray-100 border-gray-200">
                        <CardContent className="pt-4">
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-gray-500">Current Grade</p>
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Hidden</Badge>
                          </div>
                          <p className="text-3xl font-bold text-gray-400">--</p>
                          <p className="text-xs text-gray-500 mt-1">
                            Available after grading period completion
                          </p>
                        </CardContent>
                      </Card>
                    )}
                    
                    {/* Tentative Grade */}
                    <Card className={computedGrades.isEligibleForTentative ? (computedGrades.isSynced ? "bg-gradient-to-br from-teal-500 to-emerald-600 text-white" : "bg-gradient-to-br from-amber-500 to-orange-600 text-white") : "bg-gray-100"}>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2">
                          <p className={computedGrades.isEligibleForTentative ? "text-sm opacity-80" : "text-sm text-gray-500"}>
                            Tentative Grade
                          </p>
                          {computedGrades.isEligibleForTentative && !computedGrades.isSynced && (
                            <span className="text-xs opacity-70 cursor-help" title="Based on Approved + Pending submissions. Subject to teacher approval.">
                              ⓘ
                            </span>
                          )}
                          {computedGrades.isSynced && (
                            <Badge variant="outline" className="text-xs bg-white/20 text-white border-white/40">Synced</Badge>
                          )}
                        </div>
                        {computedGrades.isEligibleForTentative ? (
                          <>
                            <p className="text-3xl font-bold">{computedGrades.tentativeGrade}</p>
                            <p className="text-xs opacity-70 mt-1">
                              {computedGrades.isSynced ? "No pending submissions" : "Includes pending submissions"}
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-gray-500 mt-2">
                            Add at least 1 entry in WW, PT, and QA to see your tentative grade.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                    
                    {/* Pending Count */}
                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2">
                          <Clock className="w-5 h-5 text-amber-500" />
                          <span className="text-sm text-gray-500">Pending</span>
                        </div>
                        <p className="text-2xl font-bold text-amber-600 mt-1">
                          {computedGrades.pendingCount}
                        </p>
                      </CardContent>
                    </Card>
                    
                    {/* Missing Categories */}
                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-5 h-5 text-gray-500" />
                          <span className="text-sm text-gray-500">Missing Categories</span>
                        </div>
                        {(() => {
                          const missingCategories: string[] = [];
                          if (computedGrades.ww.count === 0) missingCategories.push("WW");
                          if (computedGrades.pt.count === 0) missingCategories.push("PT");
                          if (computedGrades.qa.count === 0) missingCategories.push("QA");
                          return missingCategories.length > 0 ? (
                            <div className="flex gap-1 mt-2">
                              {missingCategories.map((cat) => (
                                <Badge key={cat} variant="outline" className="text-gray-600">{cat}</Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-green-600 mt-2 font-medium">All categories covered ✓</p>
                          );
                        })()}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Grade Breakdown */}
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FileText className="w-5 h-5 text-blue-500" />
                            <span className="text-sm text-gray-500">Written Works</span>
                          </div>
                          <Badge variant={computedGrades.ww.count > 0 ? "default" : "outline"} className={computedGrades.ww.count > 0 ? "bg-green-600" : "text-gray-400"}>
                            {computedGrades.ww.count > 0 ? "✓" : "Missing"}
                          </Badge>
                        </div>
                        <p className="text-xl font-semibold mt-2">
                          {computedGrades.ww.percent.toFixed(1)}%
                        </p>
                        <Progress value={computedGrades.ww.percent} className="mt-2" />
                        <p className="text-xs text-gray-400 mt-1">{computedGrades.ww.count} submission(s) • {computedGrades.ww.earned}/{computedGrades.ww.max}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Award className="w-5 h-5 text-purple-500" />
                            <span className="text-sm text-gray-500">Performance Tasks</span>
                          </div>
                          <Badge variant={computedGrades.pt.count > 0 ? "default" : "outline"} className={computedGrades.pt.count > 0 ? "bg-green-600" : "text-gray-400"}>
                            {computedGrades.pt.count > 0 ? "✓" : "Missing"}
                          </Badge>
                        </div>
                        <p className="text-xl font-semibold mt-2">
                          {computedGrades.pt.percent.toFixed(1)}%
                        </p>
                        <Progress value={computedGrades.pt.percent} className="mt-2" />
                        <p className="text-xs text-gray-400 mt-1">{computedGrades.pt.count} submission(s) • {computedGrades.pt.earned}/{computedGrades.pt.max}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ClipboardCheck className="w-5 h-5 text-amber-500" />
                            <span className="text-sm text-gray-500">Quarterly Assessment</span>
                          </div>
                          <Badge variant={computedGrades.qa.count > 0 ? "default" : "outline"} className={computedGrades.qa.count > 0 ? "bg-green-600" : "text-gray-400"}>
                            {computedGrades.qa.count > 0 ? "✓" : "Missing"}
                          </Badge>
                        </div>
                        <p className="text-xl font-semibold mt-2">
                          {computedGrades.qa.percent.toFixed(1)}%
                        </p>
                        <Progress value={computedGrades.qa.percent} className="mt-2" />
                        <p className="text-xs text-gray-400 mt-1">{computedGrades.qa.count} submission(s) • {computedGrades.qa.earned}/{computedGrades.qa.max}</p>
                      </CardContent>
                    </Card>
                  </div>
                </>
              ) : (
                <Card className="p-8 text-center">
                  <p className="text-gray-500">Unable to compute grades. Please try again.</p>
                </Card>
              )}

              {/* Activity Records Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">My Activity Records</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Search and Filter Controls */}
                  <div className="flex flex-wrap gap-3 mb-4">
                    <Input
                      placeholder="Search by activity title..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-1 min-w-[200px]"
                    />
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Filter by category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Categories</SelectItem>
                        <SelectItem value="WRITTEN_WORK">Written Works</SelectItem>
                        <SelectItem value="PERFORMANCE_TASK">Performance Tasks</SelectItem>
                        <SelectItem value="QUARTERLY_ASSESSMENT">Quarterly Assessment</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                      <SelectTrigger className="w-[150px]">
                        <SelectValue placeholder="Sort by" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dueDate">Due Date</SelectItem>
                        <SelectItem value="status">Status</SelectItem>
                        <SelectItem value="title">Title</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                      title={sortOrder === "asc" ? "Ascending" : "Descending"}
                    >
                      {sortOrder === "asc" ? "↑" : "↓"}
                    </Button>
                  </div>

                  {/* Table with horizontal scroll */}
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="border px-3 py-2 text-left">Category</th>
                          <th className="border px-3 py-2 text-left">Activity Title</th>
                          <th className="border px-3 py-2 text-center">Due Date</th>
                          <th className="border px-3 py-2 text-center">Max</th>
                          <th className="border px-3 py-2 text-center">My Score</th>
                          <th className="border px-3 py-2 text-center">Status</th>
                          <th className="border px-3 py-2 text-left">Teacher Feedback</th>
                          <th className="border px-3 py-2 text-center">Updated</th>
                          <th className="border px-3 py-2 text-center">Evidence</th>
                          <th className="border px-3 py-2 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          // Build combined list of activities with submissions
                          const activities = (classDetails?.activities || []).filter((a: Activity) => !a.archived);
                          const submissionMap = new Map<string, Submission>();
                          submissions.forEach((s: Submission) => {
                            if (s.activity?.class?.name === selectedClass?.name || s.activityId) {
                              submissionMap.set(s.activityId, s);
                            }
                          });

                          // Create rows for all activities
                          let rows = activities.map((activity: Activity) => {
                            const submission = submissionMap.get(activity.id);
                            return {
                              activity,
                              submission,
                              status: submission?.status || "MISSING",
                            };
                          });

                          // Apply search filter
                          if (searchQuery) {
                            const query = searchQuery.toLowerCase();
                            rows = rows.filter((r) => 
                              r.activity.title.toLowerCase().includes(query)
                            );
                          }

                          // Apply category filter
                          if (categoryFilter !== "ALL") {
                            rows = rows.filter((r) => r.activity.category === categoryFilter);
                          }

                          // Sort
                          rows.sort((a, b) => {
                            let cmp = 0;
                            if (sortBy === "dueDate") {
                              const dateA = a.activity.dueDate ? new Date(a.activity.dueDate).getTime() : Infinity;
                              const dateB = b.activity.dueDate ? new Date(b.activity.dueDate).getTime() : Infinity;
                              cmp = dateA - dateB;
                            } else if (sortBy === "status") {
                              const statusOrder = ["MISSING", "DECLINED", "NEEDS_REVISION", "PENDING", "APPROVED"];
                              cmp = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
                            } else {
                              cmp = a.activity.title.localeCompare(b.activity.title);
                            }
                            return sortOrder === "asc" ? cmp : -cmp;
                          });

                          return rows.map((row, index) => {
                            const { activity, submission, status } = row;
                            
                            return (
                              <tr key={activity.id || `row-${index}`} className="hover:bg-gray-50">
                                <td className="border px-3 py-2">
                                  <Badge variant="outline" className="text-xs">
                                    {activity.category === "WRITTEN_WORK" ? "WW" : 
                                     activity.category === "PERFORMANCE_TASK" ? "PT" : "QA"}
                                  </Badge>
                                </td>
                                <td className="border px-3 py-2 font-medium">{activity.title}</td>
                                <td className="border px-3 py-2 text-center text-xs">
                                  {activity.dueDate ? format(new Date(activity.dueDate), "MMM d, yyyy") : "-"}
                                </td>
                                <td className="border px-3 py-2 text-center">{activity.maxScore}</td>
                                <td className="border px-3 py-2 text-center font-semibold">
                                  {submission ? `${submission.rawScore}` : "-"}
                                </td>
                                <td className="border px-3 py-2 text-center">
                                  {status === "MISSING" ? (
                                    <Badge variant="outline" className="text-gray-600 border-gray-400">Missing</Badge>
                                  ) : status === "PENDING" ? (
                                    <Badge variant="outline" className="text-amber-600 border-amber-400">Pending</Badge>
                                  ) : status === "APPROVED" ? (
                                    <Badge variant="default" className="bg-green-600">Approved</Badge>
                                  ) : status === "DECLINED" ? (
                                    <Badge variant="destructive">Declined</Badge>
                                  ) : (
                                    <Badge variant="secondary">Needs Revision</Badge>
                                  )}
                                </td>
                                <td className="border px-3 py-2 text-xs max-w-[150px] truncate" title={submission?.teacherFeedback || ""}>
                                  {submission?.teacherFeedback || "-"}
                                </td>
                                <td className="border px-3 py-2 text-center text-xs">
                                  {submission?.updatedAt ? format(new Date(submission.updatedAt), "MMM d") : "-"}
                                </td>
                                <td className="border px-3 py-2 text-center">
                                  {submission?.evidenceUrl ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => window.open(submission.evidenceUrl!, "_blank")}
                                    >
                                      <Eye className="w-4 h-4" />
                                    </Button>
                                  ) : "-"}
                                </td>
                                <td className="border px-3 py-2 text-center">
                                  {(status === "MISSING" || status === "DECLINED" || status === "NEEDS_REVISION") && (
                                    <Button
                                      size="sm"
                                      className="bg-teal-600 hover:bg-teal-700"
                                      onClick={() => setSubmitActivity(activity)}
                                    >
                                      {status === "MISSING" ? "Submit" : "Resubmit"}
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>

                  {(classDetails?.activities || []).filter((a: Activity) => !a.archived).length === 0 && (
                    <p className="text-center text-gray-500 py-8">No activities found for this class.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "standing" && !selectedClass && (
            <Card className="p-8 text-center">
              <BookOpen className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium mb-2">Select a Class</h3>
              <p className="text-gray-500">Choose a class from the sidebar to view your standing</p>
            </Card>
          )}

          {/* Pending Tab */}
          {activeTab === "pending" && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Pending Items</h2>

              {/* Needs Revision */}
              {stats.needsRevision > 0 && (
                <Card className="border-amber-200 bg-amber-50">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
                      <AlertCircle className="w-4 h-4" />
                      Needs Your Attention ({stats.needsRevision})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {submissions
                      .filter((s: Submission) => s.status === "NEEDS_REVISION" || s.status === "DECLINED")
                      .map((s: Submission) => (
                        <div key={s.id} className="p-3 bg-white rounded border">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-medium">{s.activity.title}</p>
                              <p className="text-sm text-gray-500">{s.activity.class?.name || "Unknown Class"}</p>
                            </div>
                            <Badge variant={s.status === "DECLINED" ? "destructive" : "secondary"}>
                              {s.status.replace("_", " ")}
                            </Badge>
                          </div>
                          {s.teacherFeedback && (
                            <p className="text-sm text-amber-700 mt-2 bg-amber-100 p-2 rounded">
                              Teacher Feedback: {s.teacherFeedback}
                            </p>
                          )}
                          <ResubmitDialog
                            submission={s}
                            onSubmit={(data) => submitMutation.mutate(data)}
                          />
                        </div>
                      ))}
                  </CardContent>
                </Card>
              )}

              {/* Pending Submissions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Awaiting Teacher Approval ({stats.pendingSubmissions})</CardTitle>
                </CardHeader>
                <CardContent>
                  {submissions.filter((s: Submission) => s.status === "PENDING").length === 0 ? (
                    <p className="text-gray-500 text-center py-4">No pending submissions</p>
                  ) : (
                    <div className="space-y-2">
                      {submissions
                        .filter((s: Submission) => s.status === "PENDING")
                        .map((s: Submission) => (
                          <div key={s.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                            <div>
                              <p className="font-medium">{s.activity.title}</p>
                              <p className="text-xs text-gray-500">
                                Submitted: {format(new Date(s.submittedAt), "MMM d, h:mm a")}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold">{s.rawScore}/{s.activity.maxScore}</p>
                              <Badge variant="outline">Pending</Badge>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Missing Submissions Tab */}
          {activeTab === "missing" && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Missing Submissions Checklist</h2>
              
              {!selectedClass ? (
                <Card className="p-8 text-center">
                  <ListChecks className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <h3 className="text-lg font-medium mb-2">Select a Class</h3>
                  <p className="text-gray-500">Choose a class from the sidebar to see missing submissions</p>
                </Card>
              ) : missingSubmissions.length === 0 ? (
                <Card className="p-8 text-center">
                  <CheckCircle className="w-12 h-12 mx-auto mb-4 text-emerald-500" />
                  <h3 className="text-lg font-medium mb-2">All Caught Up!</h3>
                  <p className="text-gray-500">You have submitted all activities for this class</p>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      {missingSubmissions.length} Missing Submission(s)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {missingSubmissions.map((activity: Activity) => (
                      <div key={activity.id} className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200">
                        <div>
                          <p className="font-medium">{activity.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {activity.category.replace("_", " ")}
                            </Badge>
                            <span className="text-xs text-gray-500">
                              {activity.maxScore} pts
                            </span>
                            {activity.dueDate && (
                              <span className="text-xs text-gray-500">
                                Due: {format(new Date(activity.dueDate), "MMM d")}
                              </span>
                            )}
                          </div>
                        </div>
                        <SubmitScoreDialog
                          activity={activity}
                          onSubmit={(data) => submitMutation.mutate(data)}
                        />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Classes Tab */}
          {activeTab === "classes" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">My Classes</h2>
                <Button onClick={() => setShowJoinClass(true)} className="bg-teal-600 hover:bg-teal-700">
                  <Plus className="w-4 h-4 mr-2" />
                  Join Class
                </Button>
              </div>

              {classes.length === 0 ? (
                <Card className="p-8 text-center">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <h3 className="text-lg font-medium mb-2">No classes joined yet</h3>
                  <p className="text-gray-500 mb-4">Ask your teacher for a class code to join</p>
                  <Button onClick={() => setShowJoinClass(true)} className="bg-teal-600">
                    Join a Class
                  </Button>
                </Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {classes.map((cls: ClassData) => (
                    <Card
                      key={cls.id}
                      className="cursor-pointer hover:shadow-lg transition-shadow"
                      onClick={() => {
                        setSelectedClass(cls);
                        setActiveTab("class");
                      }}
                    >
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          {cls.name}
                          {cls.semester === 1 ? (
                            <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-xs">Sem 1</Badge>
                          ) : cls.semester === 2 ? (
                            <Badge className="bg-purple-600 text-xs">Sem 2</Badge>
                          ) : null}
                        </CardTitle>
                        <CardDescription>{cls.subject} - {cls.section}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center justify-between text-sm text-gray-500">
                          <span>{cls.quarterRange || `Q${cls.quarter}`} | {cls.schoolYear}</span>
                          <span>{(cls as { owner?: { name: string } }).owner?.name}</span>
                        </div>
                        {cls.linkedFrom && (
                          <div className="mt-2 text-xs text-purple-600 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Auto-enrolled from Sem 1
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Class Detail (Submit Activities) */}
          {activeTab === "class" && selectedClass && classDetails && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">{classDetails.name}</h2>
                  <p className="text-gray-500">{classDetails.subject} - {classDetails.section}</p>
                </div>
              </div>

              {["WRITTEN_WORK", "PERFORMANCE_TASK", "QUARTERLY_ASSESSMENT"].map((category) => {
                const activities = classDetails.activities?.filter((a: Activity) => a.category === category) || [];
                return (
                  <Card key={category}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        {category === "WRITTEN_WORK" && <FileText className="w-4 h-4" />}
                        {category === "PERFORMANCE_TASK" && <Award className="w-4 h-4" />}
                        {category === "QUARTERLY_ASSESSMENT" && <ClipboardCheck className="w-4 h-4" />}
                        {category.replace("_", " ")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {activities.length === 0 ? (
                        <p className="text-sm text-gray-400 py-2">No activities yet</p>
                      ) : (
                        activities.map((activity: Activity) => {
                          const submission = submissions.find((s: Submission) => s.activityId === activity.id);
                          return (
                            <div key={activity.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                              <div className="flex-1">
                                <p className="font-medium">{activity.title}</p>
                                <p className="text-sm text-gray-500">
                                  Max Score: {activity.maxScore}
                                  {activity.dueDate && (
                                    <span className="ml-2">
                                      | Due: {format(new Date(activity.dueDate), "MMM d")}
                                    </span>
                                  )}
                                </p>
                              </div>
                              {submission ? (
                                <div className="text-right">
                                  <p className="font-semibold">
                                    {submission.rawScore}/{activity.maxScore}
                                  </p>
                                  <Badge variant={
                                    submission.status === "APPROVED" ? "default" :
                                    submission.status === "DECLINED" ? "destructive" :
                                    submission.status === "NEEDS_REVISION" ? "secondary" : "outline"
                                  }>
                                    {submission.status.replace("_", " ")}
                                  </Badge>
                                </div>
                              ) : (
                                <SubmitScoreDialog
                                  activity={activity}
                                  onSubmit={(data) => submitMutation.mutate(data)}
                                />
                              )}
                            </div>
                          );
                        })
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* Join Class Dialog */}
      <Dialog open={showJoinClass} onOpenChange={setShowJoinClass}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join a Class</DialogTitle>
            <DialogDescription>Enter the class code provided by your teacher</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              joinClassMutation.mutate(formData.get("code") as string);
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="classCode">Class Code</Label>
              <Input
                id="classCode"
                name="code"
                required
                placeholder="Enter 8-character code"
                className="text-center text-xl tracking-wider"
                maxLength={8}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowJoinClass(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-teal-600" disabled={joinClassMutation.isPending}>
                Join Class
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* QR Scanner Dialog */}
      <Dialog open={showQRScanner} onOpenChange={setShowQRScanner}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scan Attendance QR</DialogTitle>
            <DialogDescription>Scan the QR code displayed by your teacher</DialogDescription>
          </DialogHeader>
          <QRScanner
            onScan={handleQRScan}
            onClose={() => setShowQRScanner(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Logout Confirmation Dialog */}
      <Dialog open={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Logout</DialogTitle>
            <DialogDescription>
              Are you sure you want to logout?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowLogoutConfirm(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              Logout
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Submit Activity Dialog (for missing/declined/revision) */}
      <Dialog open={!!submitActivity} onOpenChange={() => setSubmitActivity(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Score</DialogTitle>
            <DialogDescription>{submitActivity?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm text-gray-500">Category</p>
                  <p className="font-medium">{submitActivity?.category?.replace("_", " ")}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500">Max Score</p>
                  <p className="text-2xl font-bold">{submitActivity?.maxScore}</p>
                </div>
              </div>
              {submitActivity?.dueDate && (
                <p className="text-sm text-gray-500 mt-2">
                  Due: {format(new Date(submitActivity.dueDate), "MMM d, yyyy h:mm a")}
                </p>
              )}
            </div>
            <SubmitActivityForm
              activity={submitActivity}
              onSubmit={(data) => {
                submitMutation.mutate(data);
                setSubmitActivity(null);
              }}
              onCancel={() => setSubmitActivity(null)}
              isPending={submitMutation.isPending}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Offline Indicator */}
      <OfflineIndicator />
    </div>
  );
}

// Submit Score Dialog
function SubmitScoreDialog({
  activity,
  onSubmit,
}: {
  activity: Activity;
  onSubmit: (data: unknown) => void;
}) {
  const [rawScore, setRawScore] = useState("");
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-teal-600 hover:bg-teal-700">
          Submit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit Score</DialogTitle>
          <DialogDescription>{activity.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-gray-50 p-4 rounded-lg text-center">
            <p className="text-sm text-gray-500">Maximum Score</p>
            <p className="text-3xl font-bold">{activity.maxScore}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rawScore">Your Score</Label>
            <Input
              id="rawScore"
              type="number"
              min="0"
              max={activity.maxScore}
              step="0.5"
              value={rawScore}
              onChange={(e) => setRawScore(e.target.value)}
              placeholder={`Enter your score (0-${activity.maxScore})`}
            />
          </div>
          {activity.requiresEvidence && (
            <div className="space-y-2">
              <Label>Evidence Required</Label>
              <p className="text-sm text-gray-500">
                This activity requires evidence. Please attach proof of your work.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes for your teacher..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() => {
                const score = parseFloat(rawScore);
                if (isNaN(score) || score < 0 || score > activity.maxScore) {
                  toast.error(`Score must be between 0 and ${activity.maxScore}`);
                  return;
                }
                onSubmit({
                  activityId: activity.id,
                  rawScore: score,
                  notes: notes || null,
                });
                setOpen(false);
                setRawScore("");
                setNotes("");
              }}
            >
              Submit Score
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Submit Activity Form Component (for missing activities)
function SubmitActivityForm({
  activity,
  onSubmit,
  onCancel,
  isPending,
}: {
  activity: Activity | null;
  onSubmit: (data: unknown) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [rawScore, setRawScore] = useState("");
  const [notes, setNotes] = useState("");

  if (!activity) return null;

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="submitScore">Your Score</Label>
        <Input
          id="submitScore"
          type="number"
          min="0"
          max={activity.maxScore}
          step="0.5"
          value={rawScore}
          onChange={(e) => setRawScore(e.target.value)}
          placeholder={`Enter your score (0-${activity.maxScore})`}
        />
      </div>
      {activity.requiresEvidence && (
        <div className="space-y-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
          <Label className="text-amber-800">Evidence Required</Label>
          <p className="text-sm text-amber-700">
            This activity requires evidence. Please attach proof of your work.
          </p>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="submitNotes">Notes (optional)</Label>
        <Textarea
          id="submitNotes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add any notes for your teacher..."
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          className="bg-teal-600 hover:bg-teal-700"
          disabled={isPending}
          onClick={() => {
            const score = parseFloat(rawScore);
            if (isNaN(score) || score < 0 || score > activity.maxScore) {
              toast.error(`Score must be between 0 and ${activity.maxScore}`);
              return;
            }
            onSubmit({
              activityId: activity.id,
              rawScore: score,
              notes: notes || null,
            });
          }}
        >
          {isPending ? "Submitting..." : "Submit Score"}
        </Button>
      </div>
    </>
  );
}

// Resubmit Dialog for needs revision/declined submissions
function ResubmitDialog({
  submission,
  onSubmit,
}: {
  submission: Submission;
  onSubmit: (data: unknown) => void;
}) {
  const maxScore = submission.activity?.maxScore || 100;
  const [rawScore, setRawScore] = useState(submission.rawScore?.toString() || "0");
  const [notes, setNotes] = useState(submission.notes || "");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="mt-2 bg-teal-600 hover:bg-teal-700">
          <RefreshCw className="w-4 h-4 mr-1" />
          Resubmit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resubmit Score</DialogTitle>
          <DialogDescription>{submission.activity?.title || "Activity"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
            <p className="text-sm font-medium text-amber-800">Previous Submission</p>
            <p className="text-sm text-amber-700">Score: {submission.rawScore}/{maxScore}</p>
            {submission.teacherFeedback && (
              <p className="text-sm text-amber-700 mt-1">Feedback: {submission.teacherFeedback}</p>
            )}
          </div>
          <div className="bg-gray-50 p-4 rounded-lg text-center">
            <p className="text-sm text-gray-500">Maximum Score</p>
            <p className="text-3xl font-bold">{maxScore}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="resubmitScore">New Score</Label>
            <Input
              id="resubmitScore"
              type="number"
              min="0"
              max={maxScore}
              step="0.5"
              value={rawScore}
              onChange={(e) => setRawScore(e.target.value)}
              placeholder={`Enter your score (0-${maxScore})`}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="resubmitNotes">Notes (optional)</Label>
            <Textarea
              id="resubmitNotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes for your teacher..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() => {
                const score = parseFloat(rawScore);
                if (isNaN(score) || score < 0 || score > maxScore) {
                  toast.error(`Score must be between 0 and ${maxScore}`);
                  return;
                }
                onSubmit({
                  activityId: submission.activityId,
                  rawScore: score,
                  notes: notes || null,
                });
                setOpen(false);
              }}
            >
              Resubmit Score
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Landing Page Component
function LandingPage({ onSelectRole }: { onSelectRole: (role: "TEACHER" | "STUDENT") => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-emerald-50 to-teal-100">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-10 h-10 text-white" />
          </div>
          <CardTitle className="text-3xl font-bold">Class Record</CardTitle>
          <CardDescription className="text-base mt-2">
            Accountability Class Record System
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-gray-600 mb-6">
            Student-accountability and teacher-transparency system for class records
          </p>
          <Button
            onClick={() => onSelectRole("TEACHER")}
            className="w-full h-16 text-lg bg-emerald-600 hover:bg-emerald-700"
          >
            <Users className="w-5 h-5 mr-2" />
            I am a Teacher
          </Button>
          <Button
            onClick={() => onSelectRole("STUDENT")}
            className="w-full h-16 text-lg bg-teal-600 hover:bg-teal-700"
          >
            <User className="w-5 h-5 mr-2" />
            I am a Student
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// Main App Component
export default function Page() {
  const { data: session, status } = useSession();
  const [mounted, setMounted] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [userRole, setUserRole] = useState<"teacher" | "student" | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset to landing when session changes
  useEffect(() => {
    if (!session) {
      setShowLanding(true);
      setUserRole(null);
    }
  }, [session]);

  if (!mounted || status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  // Show auth screen if no session
  if (!session) {
    return <AuthScreen onSuccess={() => {}} />;
  }

  // Function to return to landing page
  const goLanding = () => {
    setUserRole(null);
    setShowLanding(true);
  };

  // Show landing page if requested
  if (showLanding) {
    return (
      <LandingPage
        onSelectRole={(role) => {
          setUserRole(role === "TEACHER" ? "teacher" : "student");
          setShowLanding(false);
        }}
      />
    );
  }

  // Show dashboard based on userRole state
  if (userRole === "teacher") {
    return <TeacherDashboard goLanding={goLanding} />;
  }

  if (userRole === "student") {
    return <StudentDashboard goLanding={goLanding} />;
  }

  // Fallback to landing if no role set
  return (
    <LandingPage
      onSelectRole={(role) => {
        setUserRole(role === "TEACHER" ? "teacher" : "student");
        setShowLanding(false);
      }}
    />
  );
}

// Supabase client for database operations
// This replaces Prisma with Supabase client

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

// Create a Supabase client for server-side operations
export const db = {
  // User operations
  user: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
      const client = await getSupabaseClient()
      let query = client.from('User').select('*')
      if (where.id) {
        query = query.eq('id', where.id)
      } else if (where.email) {
        query = query.eq('email', where.email)
      }
      const { data, error } = await query.single()
      if (error) return null
      return data
    },
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
      const client = await getSupabaseClient()
      let query = client.from('User').select('*')
      if (where) {
        Object.entries(where).forEach(([key, value]) => {
          query = query.eq(key, value)
        })
      }
      const { data, error } = await query
      if (error) return []
      return data
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('User')
        .insert({ ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .select()
        .single()
      if (error) throw error
      return result
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('User')
        .update({ ...data, updatedAt: new Date().toISOString() })
        .eq('id', where.id)
        .select()
        .single()
      if (error) throw error
      return result
    },
  },

  // Student Profile operations
  studentProfile: {
    findUnique: async ({ where }: { where: { userId?: string; id?: string } }) => {
      const client = await getSupabaseClient()
      let query = client.from('StudentProfile').select('*')
      if (where.userId) {
        query = query.eq('userId', where.userId)
      } else if (where.id) {
        query = query.eq('id', where.id)
      }
      const { data, error } = await query.single()
      if (error) return null
      return data
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('StudentProfile')
        .insert({ ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .select()
        .single()
      if (error) throw error
      return result
    },
    update: async ({ where, data }: { where: { userId: string }; data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('StudentProfile')
        .update({ ...data, updatedAt: new Date().toISOString() })
        .eq('userId', where.userId)
        .select()
        .single()
      if (error) throw error
      return result
    },
  },

  // Class operations
  class: {
    findUnique: async ({ where, include }: { where: { id?: string; code?: string }; include?: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      let query = client.from('Class').select('*')
      if (where.id) {
        query = query.eq('id', where.id)
      } else if (where.code) {
        query = query.eq('code', where.code)
      }
      const { data, error } = await query.single()
      if (error) return null
      return data
    },
    findMany: async ({ where, include, orderBy }: { where?: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: Record<string, unknown> } = {}) => {
      const client = await getSupabaseClient()
      let query = client.from('Class').select('*')
      if (where) {
        Object.entries(where).forEach(([key, value]) => {
          if (value !== undefined) {
            query = query.eq(key, value)
          }
        })
      }
      const { data, error } = await query
      if (error) return []
      return data
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('Class')
        .insert({ ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .select()
        .single()
      if (error) throw error
      return result
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('Class')
        .update({ ...data, updatedAt: new Date().toISOString() })
        .eq('id', where.id)
        .select()
        .single()
      if (error) throw error
      return result
    },
  },

  // Enrollment operations
  enrollment: {
    findMany: async ({ where, include }: { where?: Record<string, unknown>; include?: Record<string, unknown> } = {}) => {
      const client = await getSupabaseClient()
      let query = client.from('Enrollment').select(`
        *,
        profile:StudentProfile (*),
        student:User (id, name, email)
      `)
      if (where) {
        Object.entries(where).forEach(([key, value]) => {
          if (value !== undefined) {
            query = query.eq(key, value)
          }
        })
      }
      const { data, error } = await query
      if (error) return []
      return data
    },
    findUnique: async ({ where }: { where: { classId_studentId?: { classId: string; studentId: string } } }) => {
      const client = await getSupabaseClient()
      if (where.classId_studentId) {
        const { data, error } = await client
          .from('Enrollment')
          .select('*')
          .eq('classId', where.classId_studentId.classId)
          .eq('studentId', where.classId_studentId.studentId)
          .single()
        if (error) return null
        return data
      }
      return null
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('Enrollment')
        .insert({ ...data, enrolledAt: new Date().toISOString() })
        .select()
        .single()
      if (error) throw error
      return result
    },
    update: async ({ where, data }: { where: { id?: string; classId_studentId?: { classId: string; studentId: string } }; data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      let query = client.from('Enrollment').update(data)
      if (where.id) {
        query = query.eq('id', where.id)
      } else if (where.classId_studentId) {
        query = query.eq('classId', where.classId_studentId.classId).eq('studentId', where.classId_studentId.studentId)
      }
      const { data: result, error } = await query.select().single()
      if (error) throw error
      return result
    },
  },

  // Activity operations
  activity: {
    findMany: async ({ where, include, orderBy }: { where?: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: unknown } = {}) => {
      const client = await getSupabaseClient()
      let query = client.from('Activity').select('*')
      if (where) {
        Object.entries(where).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            query = query.eq(key, value)
          }
        })
      }
      const { data, error } = await query.order('order', { ascending: true })
      if (error) return []
      return data
    },
    findUnique: async ({ where, include }: { where: { id: string }; include?: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data, error } = await client
        .from('Activity')
        .select('*')
        .eq('id', where.id)
        .single()
      if (error) return null
      return data
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('Activity')
        .insert({ ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .select()
        .single()
      if (error) throw error
      return result
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('Activity')
        .update({ ...data, updatedAt: new Date().toISOString() })
        .eq('id', where.id)
        .select()
        .single()
      if (error) throw error
      return result
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const client = await getSupabaseClient()
      const { error } = await client.from('Activity').delete().eq('id', where.id)
      if (error) throw error
      return { success: true }
    },
  },

  // Score Submission operations
  scoreSubmission: {
    findMany: async ({ where, include, orderBy }: { where?: Record<string, unknown>; include?: Record<string, boolean | object>; orderBy?: unknown } = {}) => {
      const client = await getSupabaseClient()
      let selectFields = '*'
      if (include?.activity) {
        selectFields = `*, activity:Activity (*)`
      }
      if (include?.student) {
        selectFields = selectFields === '*' ? `*, student:User (*)` : `${selectFields}, student:User (*)`
      }
      let query = client.from('ScoreSubmission').select(selectFields)
      if (where) {
        Object.entries(where).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            query = query.eq(key, value)
          }
        })
      }
      const { data, error } = await query.order('submittedAt', { ascending: false })
      if (error) return []
      return data
    },
    findUnique: async ({ where }: { where: { id?: string; activityId_studentId?: { activityId: string; studentId: string } } }) => {
      const client = await getSupabaseClient()
      if (where.id) {
        const { data, error } = await client.from('ScoreSubmission').select('*').eq('id', where.id).single()
        if (error) return null
        return data
      }
      if (where.activityId_studentId) {
        const { data, error } = await client
          .from('ScoreSubmission')
          .select('*')
          .eq('activityId', where.activityId_studentId.activityId)
          .eq('studentId', where.activityId_studentId.studentId)
          .single()
        if (error) return null
        return data
      }
      return null
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('ScoreSubmission')
        .insert({ ...data, submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .select()
        .single()
      if (error) throw error
      return result
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('ScoreSubmission')
        .update({ ...data, updatedAt: new Date().toISOString() })
        .eq('id', where.id)
        .select()
        .single()
      if (error) throw error
      return result
    },
  },

  // Notification operations
  notification: {
    findMany: async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: unknown } = {}) => {
      const client = await getSupabaseClient()
      let query = client.from('Notification').select(`
        *,
        fromUser:User!Notification_fromUserId_fkey (name)
      `)
      if (where) {
        Object.entries(where).forEach(([key, value]) => {
          if (value !== undefined) {
            query = query.eq(key, value)
          }
        })
      }
      const { data, error } = await query.order('createdAt', { ascending: false })
      if (error) return []
      return data
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('Notification')
        .insert({ ...data, createdAt: new Date().toISOString() })
        .select()
        .single()
      if (error) throw error
      return result
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('Notification')
        .update(data)
        .eq('id', where.id)
        .select()
        .single()
      if (error) throw error
      return result
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      let query = client.from('Notification').update(data)
      Object.entries(where).forEach(([key, value]) => {
        if (value !== undefined) {
          query = query.eq(key, value)
        }
      })
      const { data: result, error } = await query.select()
      if (error) throw error
      return { count: result?.length || 0 }
    },
  },

  // Grading Scheme operations
  gradingScheme: {
    findUnique: async ({ where }: { where: { classId: string } }) => {
      const client = await getSupabaseClient()
      const { data, error } = await client
        .from('GradingScheme')
        .select('*')
        .eq('classId', where.classId)
        .single()
      if (error) return null
      return data
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('GradingScheme')
        .insert({ ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .select()
        .single()
      if (error) throw error
      return result
    },
    update: async ({ where, data }: { where: { classId: string }; data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('GradingScheme')
        .update({ ...data, updatedAt: new Date().toISOString() })
        .eq('classId', where.classId)
        .select()
        .single()
      if (error) throw error
      return result
    },
  },

  // Attendance Session operations
  attendanceSession: {
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
      const client = await getSupabaseClient()
      let query = client.from('AttendanceSession').select('*')
      if (where) {
        Object.entries(where).forEach(([key, value]) => {
          if (value !== undefined) {
            query = query.eq(key, value)
          }
        })
      }
      const { data, error } = await query.order('date', { ascending: false })
      if (error) return []
      return data
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const client = await getSupabaseClient()
      const { data, error } = await client.from('AttendanceSession').select('*').eq('id', where.id).single()
      if (error) return null
      return data
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('AttendanceSession')
        .insert({ ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .select()
        .single()
      if (error) throw error
      return result
    },
  },

  // Attendance Submission operations
  attendanceSubmission: {
    findMany: async ({ where, include }: { where?: Record<string, unknown>; include?: Record<string, unknown> } = {}) => {
      const client = await getSupabaseClient()
      let query = client.from('AttendanceSubmission').select('*')
      if (where) {
        Object.entries(where).forEach(([key, value]) => {
          if (value !== undefined) {
            query = query.eq(key, value)
          }
        })
      }
      const { data, error } = await query
      if (error) return []
      return data
    },
    findUnique: async ({ where }: { where: { sessionId_studentId: { sessionId: string; studentId: string } } }) => {
      const client = await getSupabaseClient()
      const { data, error } = await client
        .from('AttendanceSubmission')
        .select('*')
        .eq('sessionId', where.sessionId_studentId.sessionId)
        .eq('studentId', where.sessionId_studentId.studentId)
        .single()
      if (error) return null
      return data
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('AttendanceSubmission')
        .insert({ ...data, submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .select()
        .single()
      if (error) throw error
      return result
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('AttendanceSubmission')
        .update({ ...data, updatedAt: new Date().toISOString() })
        .eq('id', where.id)
        .select()
        .single()
      if (error) throw error
      return result
    },
  },

  // Audit Log operations
  auditLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('AuditLog')
        .insert({ ...data, createdAt: new Date().toISOString() })
        .select()
        .single()
      if (error) throw error
      return result
    },
    findMany: async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: unknown } = {}) => {
      const client = await getSupabaseClient()
      let query = client.from('AuditLog').select('*')
      if (where) {
        Object.entries(where).forEach(([key, value]) => {
          if (value !== undefined) {
            query = query.eq(key, value)
          }
        })
      }
      const { data, error } = await query.order('createdAt', { ascending: false })
      if (error) return []
      return data
    },
  },

  // OTP operations
  otp: {
    findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: unknown }) => {
      const client = await getSupabaseClient()
      let query = client.from('OTP').select('*')
      Object.entries(where).forEach(([key, value]) => {
        if (value !== undefined) {
          query = query.eq(key, value)
        }
      })
      const { data, error } = await query.order('createdAt', { ascending: false }).limit(1)
      if (error || !data || data.length === 0) return null
      return data[0]
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('OTP')
        .insert({ ...data, createdAt: new Date().toISOString() })
        .select()
        .single()
      if (error) throw error
      return result
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const client = await getSupabaseClient()
      const { data: result, error } = await client
        .from('OTP')
        .update(data)
        .eq('id', where.id)
        .select()
        .single()
      if (error) throw error
      return result
    },
  },

  // Transmutation Rule operations
  transmutationRule: {
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
      const client = await getSupabaseClient()
      let query = client.from('TransmutationRule').select('*')
      if (where) {
        Object.entries(where).forEach(([key, value]) => {
          if (value !== undefined) {
            query = query.eq(key, value)
          }
        })
      }
      const { data, error } = await query
      if (error) return []
      return data
    },
  },

  // Raw query for health check
  $queryRaw: async (query: TemplateStringsArray) => {
    const client = await getSupabaseClient()
    // Simple health check query
    const { error } = await client.from('User').select('id').limit(1)
    if (error) throw error
    return [{ '?column?': 1 }] // Return something like SELECT 1
  },

  // Transaction support (Supabase doesn't have direct equivalent, but we can simulate)
  $transaction: async <T>(operations: Promise<T>[]) => {
    // For now, just execute all operations sequentially
    const results = []
    for (const op of operations) {
      results.push(await op)
    }
    return results
  },
}

// Helper to get Supabase client
async function getSupabaseClient() {
  const cookieStore = await cookies()
  
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables')
  }
  
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Handle cookie errors
        }
      },
    },
  })
}

// Also export getSupabaseClient for direct use
export { getSupabaseClient }

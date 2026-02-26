"use client";

import { useState, useEffect, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { User, Session } from "@supabase/supabase-js";

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  role: "TEACHER" | "STUDENT";
  avatar?: string;
  studentProfile?: {
    fullName: string;
    lrn: string;
    sex?: string;
    section?: string;
  };
}

interface UseSupabaseAuthReturn {
  user: UserProfile | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (data: SignUpData) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

interface SignUpData {
  email: string;
  password: string;
  name: string;
  role: "TEACHER" | "STUDENT";
  fullName?: string;
  lrn?: string;
  sex?: "M" | "F";
}

export function useSupabaseAuth(): UseSupabaseAuthReturn {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createSupabaseBrowserClient();

  const fetchUserProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    try {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select(`
          id,
          email,
          name,
          role,
          avatar,
          studentProfile:student_profiles (
            fullName,
            lrn,
            sex,
            section
          )
        `)
        .eq("id", userId)
        .single();

      if (userError) {
        console.error("Error fetching user profile:", userError);
        return null;
      }

      return {
        ...userData,
        studentProfile: userData.studentProfile?.[0] || undefined,
      } as UserProfile;
    } catch (err) {
      console.error("Error fetching user profile:", err);
      return null;
    }
  }, [supabase]);

  const refreshUser = useCallback(async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      
      if (currentSession?.user) {
        setSession(currentSession);
        const profile = await fetchUserProfile(currentSession.user.id);
        setUser(profile);
      } else {
        setSession(null);
        setUser(null);
      }
    } catch (err) {
      console.error("Error refreshing user:", err);
    }
  }, [supabase, fetchUserProfile]);

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        
        if (!mounted) return;
        
        if (initialSession?.user) {
          setSession(initialSession);
          const profile = await fetchUserProfile(initialSession.user.id);
          if (mounted) {
            setUser(profile);
          }
        }
      } catch (err) {
        console.error("Auth init error:", err);
        if (mounted) {
          setError("Failed to initialize authentication");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return;
        
        setSession(newSession);
        
        if (newSession?.user) {
          const profile = await fetchUserProfile(newSession.user.id);
          if (mounted) {
            setUser(profile);
          }
        } else {
          setUser(null);
        }
        
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase, fetchUserProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setLoading(false);
        return { error: signInError.message };
      }

      if (data.session) {
        setSession(data.session);
        const profile = await fetchUserProfile(data.session.user.id);
        setUser(profile);
      }

      setLoading(false);
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign in failed";
      setError(message);
      setLoading(false);
      return { error: message };
    }
  }, [supabase, fetchUserProfile]);

  const signUp = useCallback(async (data: SignUpData) => {
    setLoading(true);
    setError(null);

    try {
      // Sign up with Supabase Auth
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            name: data.name,
            role: data.role,
          },
        },
      });

      if (signUpError) {
        setLoading(false);
        return { error: signUpError.message };
      }

      if (!authData.user) {
        setLoading(false);
        return { error: "Failed to create account" };
      }

      // Create user profile in users table
      const { error: profileError } = await supabase
        .from("users")
        .insert({
          id: authData.user.id,
          email: data.email,
          name: data.name,
          role: data.role,
        });

      if (profileError) {
        console.error("Error creating user profile:", profileError);
        // Try to clean up auth user
        await supabase.auth.signOut();
        setLoading(false);
        return { error: "Failed to create user profile" };
      }

      // Create student profile if role is STUDENT
      if (data.role === "STUDENT" && data.fullName && data.lrn) {
        const { error: studentProfileError } = await supabase
          .from("student_profiles")
          .insert({
            userId: authData.user.id,
            fullName: data.fullName,
            lrn: data.lrn,
            sex: data.sex,
          });

        if (studentProfileError) {
          console.error("Error creating student profile:", studentProfileError);
        }
      }

      setLoading(false);
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign up failed";
      setError(message);
      setLoading(false);
      return { error: message };
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setSession(null);
    } catch (err) {
      console.error("Sign out error:", err);
    }
  }, [supabase]);

  return {
    user,
    session,
    loading,
    error,
    signIn,
    signUp,
    signOut,
    refreshUser,
  };
}

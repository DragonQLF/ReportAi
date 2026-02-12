"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { User, CreditCard, LogOut, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Navbar } from "@/components/navbar";
import { authClient } from "@/lib/auth-client";
import { api } from "@/lib/api";

export default function SettingsPage() {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  const [reportCount, setReportCount] = useState<number | null>(null);

  useEffect(() => {
    if (!sessionLoading && !session?.user) {
      router.replace("/auth");
    }
  }, [session, sessionLoading, router]);

  useEffect(() => {
    if (session?.user) {
      api.listReports(1, 1).then((data) => setReportCount(data.pagination.total)).catch(() => {});
    }
  }, [session]);

  if (sessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session?.user) return null;

  const user = session.user;

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <h1 className="text-2xl font-bold tracking-tight mb-8">Settings</h1>

        <div className="space-y-6">
          {/* Profile */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                {user.image ? (
                  <img
                    src={user.image}
                    alt={user.name || "User"}
                    className="h-14 w-14 rounded-full ring-2 ring-border"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted ring-2 ring-border">
                    <User className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div>
                  <p className="font-medium">{user.name || "—"}</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Profile information is managed through Google OAuth and cannot be edited here.
              </p>
            </CardContent>
          </Card>

          {/* Plan */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                Plan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Free</Badge>
                  <span className="text-sm text-muted-foreground">1 watermarked report</span>
                </div>
                <Link href="/#pricing">
                  <Button variant="outline" size="sm">View pricing</Button>
                </Link>
              </div>
              <Separator />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span>
                  {reportCount === null ? "Loading…" : `${reportCount} report${reportCount !== 1 ? "s" : ""} generated`}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Account */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <LogOut className="h-4 w-4" />
                Account
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="gap-2 text-destructive hover:text-destructive"
                onClick={() => authClient.signOut().then(() => router.push("/"))}
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

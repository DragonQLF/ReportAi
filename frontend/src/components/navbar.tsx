"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import {
  Sun,
  Moon,
  LogOut,
  LayoutDashboard,
  Plus,
  User,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export function Navbar() {
  const { data: session } = authClient.useSession();
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = React.useState(false);
  const [avatarError, setAvatarError] = React.useState(false);

  const handleNewReport = () => {
    if (pathname.startsWith("/reports/new")) {
      // Force full remount to clear all chat/field state from the previous session
      window.location.href = "/reports/new";
    } else {
      router.push("/reports/new");
    }
  };

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const isLanding = pathname === "/";

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
      className={cn(
        "fixed top-0 left-0 right-0 z-50 border-b border-border/40",
        "bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60"
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="group">
          <span className="font-heading text-xl font-bold tracking-tight">
            Report<span className="text-primary italic">AI</span>
          </span>
        </Link>

        {/* Nav Links + Actions */}
        <div className="flex items-center gap-2">
          {session?.user && !isLanding && (
            <div className="hidden sm:flex items-center gap-1 mr-2">
              <Link href="/dashboard">
                <Button
                  variant={pathname === "/dashboard" ? "secondary" : "ghost"}
                  size="sm"
                  className="gap-2"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </Button>
              </Link>
              <Button
                variant={pathname === "/reports/new" ? "secondary" : "ghost"}
                size="sm"
                className="gap-2"
                onClick={handleNewReport}
              >
                <Plus className="h-4 w-4" />
                New Report
              </Button>
            </div>
          )}

          {/* Theme Toggle */}
          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="h-9 w-9"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
              <span className="sr-only">Toggle theme</span>
            </Button>
          )}

          {/* Auth */}
          {session?.user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full">
                  {session.user.image && !avatarError ? (
                    <img
                      src={session.user.image}
                      alt={session.user.name || "User"}
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarError(true)}
                      className="h-7 w-7 rounded-full ring-2 ring-border"
                    />
                  ) : (
                    <User className="h-4 w-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{session.user.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {session.user.email}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="sm:hidden">
                  <Link href="/dashboard" className="gap-2">
                    <LayoutDashboard className="h-4 w-4" />
                    Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem className="sm:hidden gap-2" onClick={handleNewReport}>
                  <Plus className="h-4 w-4" />
                  New Report
                </DropdownMenuItem>
                <DropdownMenuSeparator className="sm:hidden" />
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="gap-2">
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => authClient.signOut()}
                  className="gap-2 text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link href="/auth">
              <Button size="sm" variant={isLanding ? "glow" : "outline"}>
                Sign In
              </Button>
            </Link>
          )}
        </div>
      </nav>
    </motion.header>
  );
}

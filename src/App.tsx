import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import Layout from './components/Layout'
import Index from './pages/Index'
import SellerDashboard from './pages/SellerDashboard'
import CourierApp from './pages/CourierApp'
import AdminDashboard from './pages/AdminDashboard'
import PublicTrackingPage from './pages/PublicTrackingPage'
import NotFound from './pages/NotFound'

// Role Guard Component
function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode
  allowedRoles?: ('admin' | 'seller' | 'courier')[]
}) {
  const { user, role, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/" replace />
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    if (role === 'courier') return <Navigate to="/courier" replace />
    if (role === 'admin') return <Navigate to="/admin" replace />
    return <Navigate to="/seller" replace />
  }

  return <>{children}</>
}

const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner richColors position="top-right" />
        <Routes>
          {/* Public Track Route */}
          <Route path="/track/:tracking_code" element={<PublicTrackingPage />} />

          {/* Root Login / Public Gateway */}
          <Route path="/" element={<Index />} />

          {/* Protected Seller & Admin Routes */}
          <Route
            path="/seller"
            element={
              <ProtectedRoute allowedRoles={['admin', 'seller']}>
                <SellerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders"
            element={
              <ProtectedRoute allowedRoles={['admin', 'seller']}>
                <SellerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/routes"
            element={
              <ProtectedRoute allowedRoles={['admin', 'seller']}>
                <SellerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customers"
            element={
              <ProtectedRoute allowedRoles={['admin', 'seller']}>
                <SellerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/couriers"
            element={
              <ProtectedRoute allowedRoles={['admin', 'seller']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute allowedRoles={['admin', 'seller']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />

          {/* Protected Admin Executive Dashboard */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />

          {/* Protected Courier Mobile App */}
          <Route
            path="/courier"
            element={
              <ProtectedRoute allowedRoles={['admin', 'courier']}>
                <CourierApp />
              </ProtectedRoute>
            }
          />
          <Route
            path="/courier/tasks"
            element={
              <ProtectedRoute allowedRoles={['admin', 'courier']}>
                <CourierApp />
              </ProtectedRoute>
            }
          />
          <Route
            path="/courier/history"
            element={
              <ProtectedRoute allowedRoles={['admin', 'courier']}>
                <CourierApp />
              </ProtectedRoute>
            }
          />
          <Route
            path="/courier/profile"
            element={
              <ProtectedRoute allowedRoles={['admin', 'courier']}>
                <CourierApp />
              </ProtectedRoute>
            }
          />

          {/* Fallback 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </TooltipProvider>
    </AuthProvider>
  </BrowserRouter>
)

export default App

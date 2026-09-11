import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import Layout from './components/Layout'
import Index from './pages/Index'
import RegisterPage from './pages/RegisterPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import PendingApprovalPage from './pages/PendingApprovalPage'
import SellerDashboard from './pages/SellerDashboard'
import CourierApp from './pages/CourierApp'
import AdminDashboard from './pages/AdminDashboard'
import CourierFuelPage from './pages/CourierFuelPage'
import CourierHistoryPage from './pages/CourierHistoryPage'
import CourierProfilePage from './pages/CourierProfilePage'
import PublicTrackingPage from './pages/PublicTrackingPage'
import NotFound from './pages/NotFound'

// Role Guard Component with User Status verification
function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode
  allowedRoles?: ('admin' | 'seller' | 'courier')[]
}) {
  const { user, role, isLoading, isAuthenticated } = useAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />
  }

  // Check courier approval status: pending or inactive couriers are directed to pending approval page
  if (role === 'courier' && (user.status === 'pending' || user.status === 'inactive')) {
    return <Navigate to="/pending-approval" replace />
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

          {/* Authentication & Access Routes */}
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Index />} />
          {/* Rota pública de registro desabilitada - exibe aviso claro e redireciona */}
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/pending-approval" element={<PendingApprovalPage />} />

          {/* Protected Seller & Admin Routes */}
          <Route
            path="/seller"
            element={
              <ProtectedRoute allowedRoles={['admin', 'seller']}>
                <SellerDashboard defaultTab="overview" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/control-tower"
            element={
              <ProtectedRoute allowedRoles={['admin', 'seller']}>
                <SellerDashboard defaultTab="control-tower" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute allowedRoles={['admin', 'seller']}>
                <SellerDashboard defaultTab="reports" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders"
            element={
              <ProtectedRoute allowedRoles={['admin', 'seller']}>
                <SellerDashboard defaultTab="overview" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/routes"
            element={
              <ProtectedRoute allowedRoles={['admin', 'seller']}>
                <SellerDashboard defaultTab="control-tower" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customers"
            element={
              <ProtectedRoute allowedRoles={['admin', 'seller']}>
                <SellerDashboard defaultTab="overview" />
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
                <AdminDashboard defaultTab="overview" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard defaultTab="couriers" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard defaultTab="couriers" />
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
            path="/courier/fuel"
            element={
              <ProtectedRoute allowedRoles={['admin', 'courier']}>
                <CourierFuelPage />
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
                <CourierHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/courier/profile"
            element={
              <ProtectedRoute allowedRoles={['admin', 'courier']}>
                <CourierProfilePage />
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

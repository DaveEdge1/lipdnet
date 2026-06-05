import React, { useState } from 'react';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  AppBar,
  Toolbar,
  Typography,
  Link,
  Container,
  Grid,
  Paper,
  Switch,
  FormControlLabel,
  Box,
  CircularProgress,
  Snackbar,
  Alert,
  Button
} from '@mui/material';
import { FileUpload as FileUploadIcon, NoteAdd as NoteAddIcon } from '@mui/icons-material';
import {
  LiPDApp,
  useLiPDStore,
  setLiPDStoreCallbacks,
  RouterProvider,
  SyncProgressBar
} from '@linkedearth/lipd-ui';

import BrowserAppBarActions from './BrowserAppBarActions';

// Set up empty callbacks for browser environment.
// The browser uses the custom BrowserAppBarActions instead of store callbacks.
setLiPDStoreCallbacks({});

const App: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState(false);

  const {
    setThemeMode,
    dataset,
    isLoading,
    loadingMessage,
    notification
  } = useLiPDStore(state => ({
    setThemeMode: state.setThemeMode,
    dataset: state.dataset,
    isLoading: state.isLoading,
    loadingMessage: state.loadingMessage,
    notification: state.notification
  }));

  const theme = createTheme({
    palette: {
      mode: isDarkMode ? 'dark' : 'light',
    },
  });

  React.useEffect(() => {
    setThemeMode(isDarkMode ? 'dark' : 'light');
  }, [isDarkMode, setThemeMode]);

  const handleNotificationClose = () => {
    useLiPDStore.setState({ notification: null });
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar variant="dense" sx={{ minHeight: 48, px: 2 }}>
          <Typography variant="subtitle1" component="div" sx={{ fontWeight: 600 }}>
            LiPD Playground
          </Typography>
          <Link href="/" underline="hover" variant="caption" sx={{ ml: 2, flexGrow: 1 }}>
            lipd.net home
          </Link>

          {/* File operations */}
          <BrowserAppBarActions />

          {/* Settings toggles - compact */}
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            ml: 2,
            '& .MuiFormControlLabel-root': {
              mr: 0.5,
            },
            '& .MuiFormControlLabel-label': {
              fontSize: '0.75rem',
              display: { xs: 'none', sm: 'block' }
            }
          }}>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={isDarkMode}
                  onChange={(e) => setIsDarkMode(e.target.checked)}
                />
              }
              label="Dark"
            />
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth={false} sx={{ mt: 2, height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
        <Grid container spacing={3} sx={{ flex: 1, minHeight: 0 }}>
          <Grid item xs={12} sx={{ height: '100%', minHeight: 0 }}>
            <Paper variant="outlined" sx={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', borderRadius: 2 }}>
              <RouterProvider>
                {isLoading ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', textAlign: 'center', gap: 2, p: 4 }}>
                    <CircularProgress size={40} />
                    <Typography variant="h5">Loading dataset...</Typography>
                    {loadingMessage && (
                      <Typography variant="body2" color="text.secondary">
                        {loadingMessage}
                      </Typography>
                    )}
                  </Box>
                ) : dataset ? (
                  <LiPDApp
                    headerProps={{ showAppBarActions: false }}
                  />
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', textAlign: 'center', gap: 2, p: 4 }}>
                    <Typography variant="h4">Welcome to the LiPD Playground</Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 560 }}>
                      Create, edit, validate, and download LiPD (Linked Paleo Data) files
                      right in your browser. Open a local <code>.lpd</code> file, load a
                      dataset from the LiPDverse GraphDB, or start a new dataset from scratch.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                      <Button variant="contained" startIcon={<NoteAddIcon />} onClick={() => window.dispatchEvent(new CustomEvent('playground-new'))}>
                        New Dataset
                      </Button>
                      <Button variant="outlined" startIcon={<FileUploadIcon />} onClick={() => window.dispatchEvent(new CustomEvent('playground-open'))}>
                        Open .lpd File
                      </Button>
                    </Box>
                  </Box>
                )}
              </RouterProvider>
            </Paper>
          </Grid>
        </Grid>
      </Container>

      {/* Sync Progress Bar - shown when syncing */}
      <SyncProgressBar />

      {/* Notification Snackbar */}
      <Snackbar
        open={Boolean(notification)}
        autoHideDuration={notification?.type === 'error' ? 8000 : 4000}
        onClose={handleNotificationClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={handleNotificationClose}
          severity={notification?.type === 'error' ? 'error' : notification?.type === 'success' ? 'success' : 'info'}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {notification?.message}
        </Alert>
      </Snackbar>
    </ThemeProvider>
  );
};

export default App;

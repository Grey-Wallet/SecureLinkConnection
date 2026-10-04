import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StatusBar,
  Text,
  TextInput,
  View,
} from "react-native";
import { getPublicInfo } from "./src/services/publicApi.js";
import { loginAsGuest } from "./src/services/securelink.js";
import { loginAsUser, logoutUser } from "./src/services/account.js";
import { createTodoService } from "./src/services/todos.js";
import { styles } from "./src/styles.js";

export default function App() {
  const [view, setView] = useState("login"); // login | app
  const [kind, setKind] = useState(null); // anonymous | customAuth
  const [label, setLabel] = useState("");
  const [publicInfo, setPublicInfo] = useState(null);
  const [todos, setTodos] = useState([]);
  const [todoApi, setTodoApi] = useState(null);
  const [title, setTitle] = useState("");
  const [username, setUsername] = useState("alex");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function loadPublic() {
    setPublicInfo(await getPublicInfo());
  }

  useEffect(() => {
    void loadPublic().catch((err) => {
      setStatus(err instanceof Error ? err.message : "Public failed");
      setError(true);
    });
  }, []);

  async function enterApp(nextKind, client, nextLabel) {
    const api = createTodoService(client);
    setTodoApi(api);
    setKind(nextKind);
    setLabel(nextLabel);
    setView("app");
    setTodos(await api.list());
    setStatus("Ready.");
    setError(false);
    await loadPublic();
  }

  async function onGuest() {
    setBusy(true);
    try {
      const session = await loginAsGuest();
      await enterApp("anonymous", session.client, session.userId);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Guest login failed");
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function onSignIn() {
    setBusy(true);
    try {
      const session = await loginAsUser(username);
      await enterApp("customAuth", session.client, session.userId);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Sign in failed");
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function onLogout() {
    logoutUser();
    setTodoApi(null);
    setTodos([]);
    setKind(null);
    setView("login");
    setStatus("Logged out.");
    setError(false);
    void loadPublic();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>SecureLink Todo</Text>
            <Text style={styles.sub}>Guest or sign in · todos belong to that user</Text>
          </View>
          {view === "app" ? (
            <Pressable style={styles.logoutBtn} onPress={onLogout}>
              <Text style={styles.logoutText}>Log out</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.label}>Public</Text>
        <Text style={styles.stats}>
          {publicInfo ? JSON.stringify(publicInfo, null, 2) : "…"}
        </Text>

        {view === "login" ? (
          <>
            <Text style={styles.label}>Login</Text>
            <Pressable style={styles.addBtn} onPress={() => void onGuest()} disabled={busy}>
              <Text style={styles.addText}>Continue as guest</Text>
            </Pressable>
            <Text style={[styles.sub, { marginVertical: 10 }]}>or</Text>
            <View style={styles.composer}>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="username"
                placeholderTextColor="#8fa6b6"
                style={styles.input}
                autoCapitalize="none"
              />
              <Pressable style={styles.addBtn} onPress={() => void onSignIn()} disabled={busy}>
                <Text style={styles.addText}>Sign in</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.label}>
              Your todos · {kind === "anonymous" ? "Guest" : "Signed in"}
            </Text>
            <Text style={styles.sub}>{label}</Text>
            <View style={styles.composer}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Add a todo…"
                placeholderTextColor="#8fa6b6"
                style={styles.input}
              />
              <Pressable
                style={styles.addBtn}
                onPress={() =>
                  void (async () => {
                    const value = title.trim();
                    if (!value || !todoApi) return;
                    setTitle("");
                    try {
                      await todoApi.create(value);
                      setTodos(await todoApi.list());
                    } catch (err) {
                      setStatus(err instanceof Error ? err.message : "Create failed");
                      setError(true);
                    }
                  })()
                }
              >
                <Text style={styles.addText}>Add</Text>
              </Pressable>
            </View>
            {busy ? (
              <ActivityIndicator color="#5eead4" style={{ marginTop: 16 }} />
            ) : (
              <FlatList
                data={todos}
                keyExtractor={(item) => item.id}
                ListEmptyComponent={<Text style={styles.empty}>No todos yet.</Text>}
                renderItem={({ item }) => (
                  <View style={styles.row}>
                    <Pressable
                      style={styles.secondary}
                      onPress={() =>
                        void todoApi
                          .setDone(item.id, !item.done)
                          .then(() => todoApi.list())
                          .then(setTodos)
                          .catch((err) => {
                            setStatus(err instanceof Error ? err.message : "Update failed");
                            setError(true);
                          })
                      }
                    >
                      <Text style={styles.secondaryText}>
                        {item.done ? "Undo" : "Done"}
                      </Text>
                    </Pressable>
                    <Text style={[styles.title, item.done && styles.done]}>
                      {item.title}
                    </Text>
                    <Pressable
                      style={styles.danger}
                      onPress={() =>
                        void todoApi
                          .remove(item.id)
                          .then(() => todoApi.list())
                          .then(setTodos)
                          .catch((err) => {
                            setStatus(err instanceof Error ? err.message : "Delete failed");
                            setError(true);
                          })
                      }
                    >
                      <Text style={styles.dangerText}>Del</Text>
                    </Pressable>
                  </View>
                )}
              />
            )}
          </>
        )}

        {busy && view === "login" ? (
          <ActivityIndicator color="#5eead4" style={{ marginTop: 16 }} />
        ) : null}
        <Text style={[styles.status, error && styles.error]}>{status}</Text>
      </View>
    </SafeAreaView>
  );
}

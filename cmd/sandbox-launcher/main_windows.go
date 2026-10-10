//go:build windows

// studio-sandbox-launcher is a small native boundary used by the desktop app
// to launch untrusted Studio plugin code in an AppContainer. It is kept out of
// the Wails renderer and receives only validated paths/flags from the host.
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	procThreadAttributeSecurityCapabilities = uintptr(0x00020009)
	procThreadAttributeHandleList           = uintptr(0x00020002)
	stdInputHandle                          = uint32(0xFFFFFFF6)
	stdOutputHandle                         = uint32(0xFFFFFFF5)
	stdErrorHandle                          = uint32(0xFFFFFFF4)
	startfUseStdHandles                     = uint32(0x00000100)
	hresultAlreadyExists                    = uintptr(0x800700B7)
)

type sidAndAttributes struct {
	Sid        *windows.SID
	Attributes uint32
}

type securityCapabilities struct {
	AppContainerSid *windows.SID
	Capabilities    *sidAndAttributes
	CapabilityCount uint32
	Reserved        uint32
}

type appContainerAPI struct {
	createProfile *syscall.LazyProc
	deriveSID     *syscall.LazyProc
	deleteProfile *syscall.LazyProc
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--probe" {
		if _, err := loadAPI(); err != nil {
			fatal(err)
		}
		return
	}

	packageRoot := flag.String("package-root", "", "verified plugin package root")
	projectRoot := flag.String("project-root", "", "verified project root")
	writeProject := flag.Bool("write-project", false, "allow project writes")
	network := flag.Bool("network", false, "allow outbound network")
	flag.Parse()
	if *packageRoot == "" || *projectRoot == "" || flag.NArg() < 1 {
		fatal(errors.New("sandbox launcher requires package/project roots and a command"))
	}
	if flag.Arg(0) != "--" {
		fatal(errors.New("sandbox launcher command must follow --"))
	}
	command := flag.Args()[1:]
	if len(command) == 0 {
		fatal(errors.New("sandbox launcher command is empty"))
	}

	if err := run(*packageRoot, *projectRoot, *writeProject, *network, command); err != nil {
		fatal(err)
	}
}

func run(packageRoot, projectRoot string, writeProject, network bool, command []string) error {
	packageRoot, err := filepath.Abs(filepath.Clean(packageRoot))
	if err != nil {
		return fmt.Errorf("resolve package root: %w", err)
	}
	projectRoot, err = filepath.Abs(filepath.Clean(projectRoot))
	if err != nil {
		return fmt.Errorf("resolve project root: %w", err)
	}
	executable, err := filepath.Abs(filepath.Clean(command[0]))
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}
	relative, err := filepath.Rel(packageRoot, executable)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return errors.New("sandbox executable escapes plugin package")
	}

	api, err := loadAPI()
	if err != nil {
		return err
	}
	identity := fmt.Sprintf("LiapoldusStudio_%d_%d", os.Getpid(), time.Now().UnixNano())
	profileSID, cleanupProfile, err := createProfile(api, identity, network)
	if err != nil {
		return err
	}
	defer cleanupProfile()

	restorePackage, err := grantAccess(packageRoot, profileSID, false)
	if err != nil {
		return fmt.Errorf("grant plugin package access: %w", err)
	}
	defer restorePackage()
	restoreProject, err := grantAccess(projectRoot, profileSID, writeProject)
	if err != nil {
		return fmt.Errorf("grant project access: %w", err)
	}
	defer restoreProject()

	return launch(profileSID, projectRoot, network, command)
}

func loadAPI() (appContainerAPI, error) {
	dll := syscall.NewLazyDLL("userenv.dll")
	api := appContainerAPI{
		createProfile: dll.NewProc("CreateAppContainerProfile"),
		deriveSID:     dll.NewProc("DeriveAppContainerSidFromAppContainerName"),
		deleteProfile: dll.NewProc("DeleteAppContainerProfile"),
	}
	if err := dll.Load(); err != nil {
		return appContainerAPI{}, fmt.Errorf("load userenv.dll: %w", err)
	}
	return api, nil
}

func createProfile(api appContainerAPI, identity string, network bool) (*windows.SID, func(), error) {
	name, err := windows.UTF16PtrFromString(identity)
	if err != nil {
		return nil, nil, err
	}
	display, err := windows.UTF16PtrFromString("Liapoldus Studio plugin")
	if err != nil {
		return nil, nil, err
	}
	description, err := windows.UTF16PtrFromString("Ephemeral AppContainer for a Liapoldus Studio plugin")
	if err != nil {
		return nil, nil, err
	}
	var capabilities []sidAndAttributes
	if network {
		capabilitySID, err := windows.CreateWellKnownSid(windows.WinCapabilityInternetClientSid)
		if err != nil {
			return nil, nil, fmt.Errorf("create internet capability SID: %w", err)
		}
		capabilities = []sidAndAttributes{{Sid: capabilitySID, Attributes: windows.SE_GROUP_ENABLED}}
	}
	var capabilityPtr *sidAndAttributes
	if len(capabilities) != 0 {
		capabilityPtr = &capabilities[0]
	}
	var profileSID *windows.SID
	result, _, callErr := api.createProfile.Call(
		uintptr(unsafe.Pointer(name)),
		uintptr(unsafe.Pointer(display)),
		uintptr(unsafe.Pointer(description)),
		uintptr(unsafe.Pointer(capabilityPtr)),
		uintptr(len(capabilities)),
		uintptr(unsafe.Pointer(&profileSID)),
	)
	if result != 0 && result != hresultAlreadyExists {
		return nil, nil, fmt.Errorf("CreateAppContainerProfile: HRESULT 0x%08x (%v)", result, callErr)
	}
	var sid *windows.SID
	result, _, callErr = api.deriveSID.Call(uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(&sid)))
	if result != 0 {
		return nil, nil, fmt.Errorf("DeriveAppContainerSidFromAppContainerName: HRESULT 0x%08x (%v)", result, callErr)
	}
	cleanup := func() {
		api.deleteProfile.Call(uintptr(unsafe.Pointer(name)))
		windows.FreeSid(sid)
	}
	return sid, cleanup, nil
}

func grantAccess(path string, sid *windows.SID, write bool) (func(), error) {
	descriptor, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return nil, err
	}
	original := descriptor.String()
	if original == "" {
		return nil, errors.New("serialize original directory security descriptor")
	}
	dacl, _, daclErr := descriptor.DACL()
	if daclErr != nil && !errors.Is(daclErr, windows.ERROR_OBJECT_NOT_FOUND) {
		return nil, daclErr
	}
	permissions := windows.ACCESS_MASK(windows.GENERIC_READ | windows.GENERIC_EXECUTE)
	if write {
		permissions |= windows.GENERIC_WRITE | windows.FILE_APPEND_DATA | windows.FILE_WRITE_ATTRIBUTES
	}
	acl, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{{
		AccessPermissions: permissions,
		AccessMode:        windows.GRANT_ACCESS,
		Inheritance:       windows.OBJECT_INHERIT_ACE | windows.CONTAINER_INHERIT_ACE,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  windows.TRUSTEE_IS_USER,
			TrusteeValue: windows.TrusteeValueFromSID(sid),
		},
	}}, dacl)
	if err != nil {
		return nil, err
	}
	if err := windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		return nil, err
	}
	return func() {
		originalDescriptor, parseErr := windows.SecurityDescriptorFromString(original)
		if parseErr != nil {
			return
		}
		originalDACL, _, originalErr := originalDescriptor.DACL()
		if originalErr != nil && !errors.Is(originalErr, windows.ERROR_OBJECT_NOT_FOUND) {
			return
		}
		_ = windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION, nil, nil, originalDACL, nil)
	}, nil
}

func launch(profileSID *windows.SID, projectRoot string, network bool, command []string) error {
	attributes, err := windows.NewProcThreadAttributeList(2)
	if err != nil {
		return fmt.Errorf("create process attributes: %w", err)
	}
	defer attributes.Delete()

	capabilities := securityCapabilities{AppContainerSid: profileSID}
	if network {
		capabilitySID, sidErr := windows.CreateWellKnownSid(windows.WinCapabilityInternetClientSid)
		if sidErr != nil {
			return sidErr
		}
		capability := sidAndAttributes{Sid: capabilitySID, Attributes: windows.SE_GROUP_ENABLED}
		capabilities.Capabilities = &capability
		capabilities.CapabilityCount = 1
	}
	if err := attributes.Update(procThreadAttributeSecurityCapabilities, unsafe.Pointer(&capabilities), unsafe.Sizeof(capabilities)); err != nil {
		return fmt.Errorf("set AppContainer capabilities: %w", err)
	}

	stdin, _ := windows.GetStdHandle(stdInputHandle)
	stdout, _ := windows.GetStdHandle(stdOutputHandle)
	stderr, _ := windows.GetStdHandle(stdErrorHandle)
	handles := []windows.Handle{stdin, stdout, stderr}
	if err := attributes.Update(procThreadAttributeHandleList, unsafe.Pointer(&handles[0]), uintptr(len(handles))*unsafe.Sizeof(handles[0])); err != nil {
		return fmt.Errorf("set standard handle list: %w", err)
	}

	startup := windows.StartupInfoEx{}
	startup.Cb = uint32(unsafe.Sizeof(startup))
	startup.Flags = startfUseStdHandles
	startup.StdInput = stdin
	startup.StdOutput = stdout
	startup.StdErr = stderr
	startup.ProcThreadAttributeList = attributes.List()
	application, err := windows.UTF16PtrFromString(command[0])
	if err != nil {
		return err
	}
	commandLine, err := windows.UTF16PtrFromString(windows.ComposeCommandLine(command))
	if err != nil {
		return err
	}
	currentDirectory, err := windows.UTF16PtrFromString(projectRoot)
	if err != nil {
		return err
	}
	processInfo := windows.ProcessInformation{}
	if err := windows.CreateProcess(application, commandLine, nil, nil, true, windows.EXTENDED_STARTUPINFO_PRESENT, nil, currentDirectory, (*windows.StartupInfo)(unsafe.Pointer(&startup)), &processInfo); err != nil {
		return fmt.Errorf("CreateProcess AppContainer: %w", err)
	}
	defer windows.CloseHandle(processInfo.Thread)
	defer windows.CloseHandle(processInfo.Process)

	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(job)
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		return err
	}
	if err := windows.AssignProcessToJobObject(job, processInfo.Process); err != nil {
		return err
	}
	if _, err := windows.WaitForSingleObject(processInfo.Process, windows.INFINITE); err != nil {
		return err
	}
	var exitCode uint32
	if err := windows.GetExitCodeProcess(processInfo.Process, &exitCode); err != nil {
		return err
	}
	if exitCode != 0 {
		return &processExitError{code: exitCode}
	}
	return nil
}

type processExitError struct{ code uint32 }

func (e *processExitError) Error() string {
	return fmt.Sprintf("sandboxed process exited with code %d", e.code)
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
